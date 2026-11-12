import StorageService from "@modules/storage/storage.service";
import NotificationService from "@modules/notification/notification.service";
import { Knowledge, Widget } from "@shared/models";
import {
  RequestFileUploadInput,
  CreateTextEntryInput,
  UpdateKnowledgeItemInput,
} from "./knowledge.types";
import { ingestionQueue } from "@shared/infra/queue";
import logger from "@shared/core/logger";
import { normalizeKnowledgeUrl } from "./knowledge-url";

class KnowledgeService {
  /**
   * Step 1 of the file upload flow.
   * Creates the DB record and returns a presigned PUT URL.
   */
  async requestFileUpload(
    meta: RequestFileUploadInput,
    uploadedBy: string,
    organizationId: string,
  ) {
    const { uploadUrl: presignedUrl, fileKey } =
      await StorageService.generatePresignedUploadUrl(
        meta.fileName,
        meta.mimeType,
        organizationId,
        600,
      );

    const doc = await Knowledge.create({
      organizationId,
      title: meta.title,
      description: meta.description,
      catalog: meta.catalog,
      source: meta.source,
      status: "pending",
      fileName: meta.fileName,
      fileKey,
      fileSize: meta.fileSize,
      mimeType: meta.mimeType,
      uploadedBy,
    });

    logger.info("📄 Knowledge upload requested", {
      documentId: String(doc._id),
      organizationId,
      title: doc.title,
      fileKey,
    });

    return { documentId: String(doc._id), presignedUrl, fileKey };
  }

  /**
   * Step 2 of the file upload flow.
   * Marks the record as "queued" and enqueues the ingestion BullMQ job.
   */
  async confirmUpload(documentId: string, organizationId: string) {
    const doc = await Knowledge.findOneAndUpdate(
      { _id: documentId, organizationId },
      { status: "queued" },
      { returnDocument: "after" },
    );

    if (!doc) return null;

    await ingestionQueue.add("ingest", {
      documentId: String(doc._id),
      organizationId,
      source: doc.source,
      fileKey: doc.fileKey!,
      mimeType: doc.mimeType!,
      fileName: doc.fileName!,
      title: doc.title,
      catalog: doc.catalog,
    });

    logger.info("✅ Knowledge document confirmed & queued", {
      documentId,
      organizationId,
    });

    await NotificationService.create({
      organizationId,
      type: "ai_sync",
      title: "Knowledge Base Queued",
      description: `'${doc.title}' has been added to the processing queue.`,
    });
    return doc;
  }

  /**
   * Create a text/URL knowledge entry and immediately enqueue for indexing.
   */
  async createTextEntry(
    data: CreateTextEntryInput,
    createdBy: string,
    organizationId: string,
  ) {
    const normalizedUrl =
      data.source === "url" && data.url
        ? normalizeKnowledgeUrl(data.url)
        : undefined;

    if (normalizedUrl) {
      const candidates = await Knowledge.find({
        organizationId,
        source: "url",
      })
        .select("sourceUrl sourceUrlNormalized")
        .lean();
      const existing = candidates.find((candidate) => {
        if (candidate.sourceUrlNormalized === normalizedUrl) return true;
        if (!candidate.sourceUrl) return false;
        try {
          return normalizeKnowledgeUrl(candidate.sourceUrl) === normalizedUrl;
        } catch {
          return false;
        }
      });
      if (existing) {
        return Knowledge.findByIdAndUpdate(
          existing._id,
          { $set: { sourceUrlNormalized: normalizedUrl } },
          { returnDocument: "after" },
        );
      }
    }

    const doc = await Knowledge.create({
      organizationId,
      title: data.title,
      description: data.description,
      catalog: data.catalog,
      source: data.source,
      status: "queued",
      content: data.content,
      sourceUrl: data.url,
      sourceUrlNormalized: normalizedUrl,
      fetchMode: data.fetchMode,
      crawlDepth: data.crawlDepth,
      syncFrequency: data.syncFrequency,
      uploadedBy: createdBy,
    });

    await ingestionQueue.add("ingest", {
      documentId: String(doc._id),
      organizationId,
      source: data.source,
      fileKey: "",
      mimeType: "text/plain",
      fileName: data.title,
      title: data.title,
      catalog: data.catalog,
      sourceUrl: data.url,
      content: data.content,
      fetchMode: data.fetchMode,
      crawlDepth: data.crawlDepth,
      syncFrequency: data.syncFrequency,
    });

    logger.info("📝 Knowledge text/URL entry created & queued", {
      documentId: String(doc._id),
      organizationId,
      title: doc.title,
    });

    await NotificationService.create({
      organizationId,
      type: "ai_sync",
      title: "Knowledge Base Queued",
      description: `'${doc.title}' has been added to the processing queue.`,
    });
    return doc;
  }

  async getItems(organizationId: string) {
    const filter: any = { organizationId };
    const items = await Knowledge.find(filter).sort({ createdAt: -1 }).lean();
    return { items, total: items.length };
  }

  async getViewUrl(documentId: string, organizationId: string) {
    const doc = await Knowledge.findOne({
      _id: documentId,
      organizationId,
    }).lean();
    if (!doc || !doc.fileKey) return null;
    const url = await StorageService.generatePresignedDownloadUrl(
      doc.fileKey,
      300,
    );
    return { url, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async reindexItem(documentId: string, organizationId: string) {
    const doc = await Knowledge.findOneAndUpdate(
      { _id: documentId, organizationId },
      { status: "queued", errorMessage: undefined },
      { returnDocument: "after" },
    );
    if (!doc) return null;

    await ingestionQueue.add("ingest", {
      documentId: String(doc._id),
      organizationId,
      source: doc.source,
      fileKey: doc.fileKey ?? "",
      mimeType: doc.mimeType ?? "text/plain",
      fileName: doc.fileName ?? doc.title,
      title: doc.title,
      catalog: doc.catalog,
      sourceUrl: doc.sourceUrl,
      content: doc.content,
      fetchMode: doc.fetchMode,
      crawlDepth: doc.crawlDepth,
      syncFrequency: doc.syncFrequency,
    });

    logger.info("🔄 Knowledge item re-queued for reindex", {
      documentId,
      organizationId,
    });

    await NotificationService.create({
      organizationId,
      type: "ai_sync",
      title: "Knowledge Base Re-queued",
      description: `'${doc.title}' has been added back to the processing queue.`,
    });
    return doc;
  }

  async updateItem(
    documentId: string,
    organizationId: string,
    patch: UpdateKnowledgeItemInput,
  ) {
    const doc = await Knowledge.findOneAndUpdate(
      { _id: documentId, organizationId },
      { $set: patch },
      { returnDocument: "after" },
    );
    if (!doc) return null;

    if (patch.isPaused === true) {
      try {
        const [waiting, delayed] = await Promise.all([
          ingestionQueue.getWaiting(),
          ingestionQueue.getDelayed(),
        ]);
        const toCancel = [...waiting, ...delayed].filter(
          (j) => j.data.documentId === documentId,
        );
        await Promise.all(toCancel.map((j) => j.remove()));
      } catch (err) {
        logger.warn("Could not cancel queued ingestion jobs on pause", {
          documentId,
          err,
        });
      }
    }

    logger.info("✏️  Knowledge item updated", {
      documentId,
      organizationId,
      patch,
    });
    return doc;
  }

  async deleteItem(documentId: string, organizationId: string) {
    const doc = await Knowledge.findOneAndDelete({
      _id: documentId,
      organizationId,
    });
    if (!doc) return null;

    if (doc.fileKey) {
      try {
        await StorageService.deleteFile(doc.fileKey);
      } catch (err) {
        logger.warn("Could not delete Silo object", { fileKey: doc.fileKey });
      }
    }

    try {
      const [waiting, delayed] = await Promise.all([
        ingestionQueue.getWaiting(),
        ingestionQueue.getDelayed(),
      ]);
      const toCancel = [...waiting, ...delayed].filter(
        (j) => j.data.documentId === documentId,
      );
      await Promise.all(toCancel.map((j) => j.remove()));
    } catch (err) {
      logger.warn("Could not cancel queued ingestion jobs", {
        documentId,
        err,
      });
    }

    await ingestionQueue.add("delete-vectors", {
      jobType: "delete-vectors",
      documentId,
      organizationId,
      source: doc.source,
      fileKey: "",
      mimeType: "",
      fileName: doc.title,
      title: doc.title,
    });

    // Remove this FAQ from the widget's quick-action suggestions automatically.
    // suggestions is a reference array (faqId) so deleting the source FAQ must
    // also clean up the pointer — otherwise the widget holds a dangling entry.
    try {
      await Widget.updateOne(
        { organizationId },
        { $pull: { suggestions: { faqId: documentId } } },
      );
      logger.info("🔗  Removed deleted FAQ from widget suggestions", {
        documentId,
        organizationId,
      });
    } catch (widgetErr) {
      logger.warn("Could not remove FAQ from widget suggestions", {
        documentId,
        widgetErr,
      });
    }

    logger.info("🗑️  Knowledge item deleted", {
      documentId,
      organizationId,
      title: doc.title,
    });
    return doc;
  }
}

export default new KnowledgeService();
