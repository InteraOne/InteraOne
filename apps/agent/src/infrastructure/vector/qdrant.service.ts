import { QdrantClient } from "@qdrant/js-client-rest";
import config from "../../config";
import { VectorStore, VectorSearchResult } from "./vector.types";

const COLLECTION = "interaOne_knowledge";

class QdrantVectorStore implements VectorStore {
  private client: QdrantClient;
  private verifiedDimensions: number | null = null;

  constructor() {
    this.client = new QdrantClient({
      url: config.qdrant.url,
      ...(config.qdrant.apiKey ? { apiKey: config.qdrant.apiKey } : {}),
    });
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const targetDimensions = 1024;
    const existing = await this.client.collectionExists(COLLECTION);

    if (existing.exists) {
      const info = await this.client.getCollection(COLLECTION);
      const existingSize = (info.config?.params?.vectors as any)?.size as
        | number
        | undefined;
      if (existingSize === targetDimensions) return;

      console.warn(
        `[Qdrant] Collection "${COLLECTION}" has ${existingSize}d but target is ${targetDimensions}d — recreating`,
      );
      await this.client.deleteCollection(COLLECTION);
    }

    await this.client.createCollection(COLLECTION, {
      vectors: { size: targetDimensions, distance: "Cosine" },
    });

    await this.client.createPayloadIndex(COLLECTION, {
      field_name: "organizationId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(COLLECTION, {
      field_name: "documentId",
      field_schema: "keyword",
    });

    console.log(
      `[Qdrant] Collection "${COLLECTION}" created (${targetDimensions}d, Cosine)`,
    );
    this.verifiedDimensions = targetDimensions;
  }

  async upsert(
    points: Array<{
      id: string;
      vector: number[];
      payload: VectorSearchResult["payload"];
    }>,
  ): Promise<void> {
    await this.client.upsert(COLLECTION, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload as Record<string, unknown>,
      })),
    });
  }

  async search(
    vector: number[],
    options: { organizationId: string; topK?: number; type?: string },
  ): Promise<VectorSearchResult[]> {
    const targetDimensions = 1024;
    console.log(`[Qdrant] ════════════════════════════════════════════════`);
    console.log(`[Qdrant] Starting vector search`);
    console.log(`[Qdrant]   Collection    : "${COLLECTION}"`);
    console.log(`[Qdrant]   Vector dim    : ${vector.length}`);
    console.log(`[Qdrant]   Organization  : ${options.organizationId}`);
    console.log(`[Qdrant]   Top K         : ${options.topK ?? 5}`);

    // Check if collection exists and check dimensions compatibility
    if (this.verifiedDimensions !== targetDimensions) {
      try {
        const collectionInfo = await this.client.getCollection(COLLECTION);
        const existingSize = (collectionInfo.config?.params?.vectors as any)
          ?.size as number | undefined;

        if (existingSize && existingSize !== targetDimensions) {
          console.warn(
            `[Qdrant] Collection "${COLLECTION}" has ${existingSize}d but target is ${targetDimensions}d — recreating collection`,
          );
          await this.client.deleteCollection(COLLECTION);
          await this.ensureCollection(targetDimensions);
        } else {
          const pointsCount = collectionInfo.points_count || 0;
          console.log(`[Qdrant]   Collection exists: YES`);
          console.log(`[Qdrant]   Total points: ${pointsCount}`);
          if (pointsCount === 0) {
            console.log(
              `[Qdrant]   ⚠️  Collection is EMPTY - no documents ingested yet`,
            );
          }
        }
        this.verifiedDimensions = targetDimensions;
      } catch (err: any) {
        const isNotFound =
          err?.status === 404 ||
          String(err?.message || "")
            .toLowerCase()
            .includes("not found");
        if (isNotFound) {
          console.log(
            `[Qdrant]   Collection exists: NO — creating with ${targetDimensions}d`,
          );
          await this.ensureCollection(targetDimensions);
        } else {
          console.error(`[Qdrant]   Failed to verify collection`, err);
          throw err;
        }
      }
    } else {
      console.log(
        `[Qdrant]   Collection dimensions verified in-memory (${targetDimensions}d)`,
      );
    }

    const mustConditions: any[] = [
      { key: "organizationId", match: { value: options.organizationId } },
    ];

    if (options.type) {
      mustConditions.push({ key: "type", match: { value: options.type } });
      console.log(
        `[Qdrant]   Filter: organizationId == "${options.organizationId}" AND type == "${options.type}"`,
      );
    } else {
      console.log(
        `[Qdrant]   Filter: organizationId == "${options.organizationId}"`,
      );
    }

    const searchParams = {
      query: vector,
      limit: options.topK ?? 5,
      filter: { must: mustConditions },
      with_payload: true,
    };

    console.log(`[Qdrant]   Executing search...`);
    const { points: results } = await this.client.query(
      COLLECTION,
      searchParams,
    );

    console.log(`[Qdrant]   ✓ Search completed`);
    console.log(`[Qdrant]   Results found: ${results.length}`);

    if (results.length > 0) {
      console.log(`[Qdrant]   Top matches:`);
      results.slice(0, 3).forEach((r, i) => {
        const payload = r.payload as any;
        console.log(
          `[Qdrant]     ${i + 1}. score=${r.score.toFixed(4)} id=${r.id} orgId=${payload?.organizationId}`,
        );
      });
    } else {
      console.log(
        `[Qdrant]   ⚠️  No results matched for organizationId: ${options.organizationId}`,
      );
      console.log(
        `[Qdrant]   Debug: Check if documents have been ingested for this organization`,
      );
    }
    console.log(`[Qdrant] ════════════════════════════════════════════════`);

    return results.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload as VectorSearchResult["payload"],
    }));
  }

  async deleteByDocumentId(
    documentId: string,
    organizationId: string,
  ): Promise<void> {
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: {
        must: [
          { key: "organizationId", match: { value: organizationId } },
          { key: "documentId", match: { value: documentId } },
        ],
      },
    });
  }
}

// Singleton
export const vectorStore: VectorStore = new QdrantVectorStore();
