import { randomUUID } from "crypto";
import { pubsubRedis } from "../cache/redis.client";

const PUBSUB_CHANNEL = "ai:response";
const STREAM_CHANNEL = "ai:stream";

export interface PublishPayload {
  conversationId: string;
  messageId?: string;
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
}

export interface ToolEventData {
  type: "start" | "complete";
  toolName: string;
  label: string;
  detail?: string;
  status?: "succeeded" | "failed";
}

export interface StreamPayload {
  conversationId: string;
  chunk: string;
  isThought: boolean;
  seq?: number;
  messageId?: string;
  toolEvent?: ToolEventData;
}

export async function publishResponse(payload: PublishPayload): Promise<void> {
  await pubsubRedis.publish(
    PUBSUB_CHANNEL,
    JSON.stringify({ ...payload, nonce: randomUUID() }),
  );
}

export async function publishStreamChunk(
  payload: StreamPayload,
): Promise<void> {
  await pubsubRedis.publish(
    STREAM_CHANNEL,
    JSON.stringify({ ...payload, nonce: randomUUID() }),
  );
}
