import { Worker, Queue } from "bullmq";
import config from "../config";
import { DocumentJob } from "../modules/ingestion/ingestion.types";
import { runIngestionPipeline } from "../modules/ingestion/pipelines/file.pipeline";
import { runUrlIngestionPipeline } from "../modules/ingestion/pipelines/url.pipeline";
import { runTextIngestionPipeline } from "../modules/ingestion/pipelines/text.pipeline";
import { runFaqIngestionPipeline } from "../modules/ingestion/pipelines/faq.pipeline";
import { vectorStore } from "../infrastructure/vector";
import { getBullMQConnection } from "../infrastructure/queue/bullmq.client";
import { getSyncDelay } from "../shared/sync";
import { acquireUrlLock, releaseUrlLock } from "../shared/locking";
import { InternalApiService } from "../infrastructure/api/internal-api.service";
import logger from "../shared/logger";

export const INGESTION_QUEUE = "document-ingestion";

export function isDeletedKnowledgeError(error: unknown): boolean {
  const candidate = error as {
    response?: { status?: number };
    status?: number;
    statusCode?: number;
    message?: string;
  };
  return (
    candidate?.response?.status === 404 ||
    candidate?.status === 404 ||
    candidate?.statusCode === 404 ||
    /(?:status code 404|knowledge document not found)/i.test(
      candidate?.message || "",
    )
  );
}

export function startKnowledgeIngestionWorker() {
  const connection = getBullMQConnection();

  const ingestionQueue = new Queue<DocumentJob>(INGESTION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  const worker = new Worker<DocumentJob, void, string>(
    INGESTION_QUEUE,
    async (job) => {
      const { source, jobType } = job.data;
      try {
        if (jobType === "delete-vectors") {
          await vectorStore.deleteByDocumentId(
            job.data.documentId,
            job.data.organizationId,
          );
          logger.info("Deleted document vectors", {
            jobId: job.id,
            queue: INGESTION_QUEUE,
            documentId: job.data.documentId,
            organizationId: job.data.organizationId,
          });
          return;
        }

        if (source === "url") {
          const lockAcquired = await acquireUrlLock(ingestionQueue, job);
          if (!lockAcquired) return;

          try {
            await runUrlIngestionPipeline(job.data);
          } finally {
            await releaseUrlLock(job.data.documentId);
          }
          return;
        }

        if (source === "text") {
          await runTextIngestionPipeline(job.data);
          return;
        }

        if (source === "faq") {
          await runFaqIngestionPipeline(job.data);
          return;
        }

        // pdf / docx
        await runIngestionPipeline(job.data);
      } catch (error) {
        // A source can be deleted while its crawl/embedding job is already
        // active. That job cannot be removed from BullMQ, and may have written
        // chunks after the original delete-vectors job ran. A final scoped
        // cleanup prevents those deleted chunks from becoming live knowledge.
        if (jobType !== "delete-vectors" && isDeletedKnowledgeError(error)) {
          await vectorStore.deleteByDocumentId(
            job.data.documentId,
            job.data.organizationId,
          );
          logger.info("Removed vectors written by a deleted active source", {
            jobId: job.id,
            queue: INGESTION_QUEUE,
            documentId: job.data.documentId,
            organizationId: job.data.organizationId,
          });
          return;
        }
        throw error;
      }
    },
    {
      connection,
      concurrency: config.worker.ingestionConcurrency,
    },
  );

  worker.on("completed", async (job) => {
    logger.info("Ingestion job completed", {
      jobId: job.id,
      queue: INGESTION_QUEUE,
      documentId: job.data.documentId,
      organizationId: job.data.organizationId,
      source: job.data.source,
      jobType: job.data.jobType,
      attemptsMade: job.attemptsMade,
    });

    if (job.data.jobType !== "delete-vectors") {
      try {
        await InternalApiService.sendNotification(
          job.data.organizationId,
          "ai_sync",
          "Knowledge Base Indexed",
          `AI training completed for '${job.data.fileName || "Data Source"}'.`,
        );
      } catch (err: any) {
        logger.warn("Failed to send ingestion completed notification", {
          jobId: job.id,
          error: err.message,
        });
      }
    }

    // Self-schedule URL re-crawl based on syncFrequency (skip for delete-vectors jobs)
    if (job.data.jobType !== "delete-vectors" && job.data.source === "url") {
      let doc: any = null;
      try {
        doc = await InternalApiService.getSyncInfo(
          job.data.documentId,
          job.data.organizationId,
        );
      } catch (err: any) {
        if (err?.response?.status === 404) {
          logger.info("Skipping re-crawl because document was deleted", {
            jobId: job.id,
            queue: INGESTION_QUEUE,
            documentId: job.data.documentId,
            organizationId: job.data.organizationId,
          });
          return;
        }
        logger.warn("Failed to fetch sync-info for re-crawl scheduling", {
          jobId: job.id,
          error: err?.response?.data?.message || err.message,
        });
        return;
      }

      if (!doc) {
        logger.info("Skipping re-crawl because document was deleted", {
          jobId: job.id,
          queue: INGESTION_QUEUE,
          documentId: job.data.documentId,
          organizationId: job.data.organizationId,
        });
        return;
      }

      if (doc.isPaused) {
        logger.info("Skipping re-crawl because source is paused", {
          jobId: job.id,
          queue: INGESTION_QUEUE,
          documentId: job.data.documentId,
          organizationId: job.data.organizationId,
        });
        return;
      }

      const syncFrequency = doc.syncFrequency || job.data.syncFrequency;
      const delay = getSyncDelay(syncFrequency);
      if (!delay) return;

      const nextJob: DocumentJob = {
        ...job.data,
        sourceUrl: doc.sourceUrl || job.data.sourceUrl,
        fetchMode: doc.fetchMode || job.data.fetchMode,
        crawlDepth: doc.crawlDepth ?? job.data.crawlDepth,
        syncFrequency,
        fileName: doc.title || job.data.fileName,
      };

      if (!nextJob.sourceUrl) {
        logger.warn("Skipping re-crawl because sourceUrl is missing", {
          jobId: job.id,
          queue: INGESTION_QUEUE,
          documentId: job.data.documentId,
          organizationId: job.data.organizationId,
        });
        return;
      }

      const recrawlJobId = `recrawl:${job.data.documentId}`;
      const existing = await ingestionQueue.getJob(recrawlJobId);
      if (existing) {
        await existing.remove();
      }

      await ingestionQueue.add("ingest", nextJob, {
        delay,
        jobId: recrawlJobId,
      });
      logger.info("Re-crawl scheduled", {
        jobId: job.id,
        queue: INGESTION_QUEUE,
        recrawlJobId,
        documentId: job.data.documentId,
        organizationId: job.data.organizationId,
        sourceUrl: nextJob.sourceUrl,
        delayMs: delay,
      });
    }
  });
  worker.on("failed", async (job, err) => {
    logger.error("Ingestion job failed", {
      jobId: job?.id,
      queue: INGESTION_QUEUE,
      documentId: job?.data.documentId,
      organizationId: job?.data.organizationId,
      source: job?.data.source,
      jobType: job?.data.jobType,
      attemptsMade: job?.attemptsMade,
      error: err,
    });

    if (job && job.data.jobType !== "delete-vectors") {
      try {
        await InternalApiService.sendNotification(
          job.data.organizationId,
          "ai_sync",
          "Knowledge Sync Failed",
          `Failed to index '${job.data.fileName || "Data Source"}'.`,
        );
      } catch (notifErr: any) {
        logger.warn("Failed to send ingestion failure notification", {
          jobId: job.id,
          error: notifErr.message,
        });
      }
    }
  });
  worker.on("error", (err) =>
    logger.error("Ingestion worker error", {
      queue: INGESTION_QUEUE,
      error: err,
    }),
  );

  logger.info("Ingestion worker started", {
    queue: INGESTION_QUEUE,
    concurrency: config.worker.ingestionConcurrency,
  });

  return worker;
}
