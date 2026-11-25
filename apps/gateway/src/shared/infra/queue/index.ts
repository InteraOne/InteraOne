import { Queue } from "bullmq";
import Redis from "ioredis";
import config from "@shared/infra/config";

export interface AIJobData {
  organizationId: string;
  conversationId: string;
  content: string;
  messageId: string;
  /** Display name of the company whose widget initiated the conversation */
  companyName?: string;
  /** Whether the widget allows escalation to a human agent */
  fallbackToAgent?: boolean;
  /** Which visitor info fields the AI should collect during the conversation */
  collectUserInfo?: {
    name?: boolean;
    email?: boolean;
    phone?: boolean;
  };
  channel?: "widget" | "email" | "whatsapp" | "telegram" | "threads";
  aiEnabled?: boolean;
  subscriptionExpired?: boolean;
}

export interface IngestionJobData {
  documentId: string;
  organizationId: string;
  /** "ingest" (default) | "delete-vectors" — drives worker behaviour */
  jobType?: "ingest" | "delete-vectors";
  /** "text" | "pdf" | "docx" | "url" — drives which path the worker takes */
  source: string;
  fileKey: string;
  mimeType: string;
  fileName: string;
  title: string;
  catalog?: string;
  /** Populated when source === "url" */
  sourceUrl?: string;
  /** Raw text content for source === "text" */
  content?: string;
  /** URL-specific crawl options */
  fetchMode?: "single" | "crawl";
  crawlDepth?: number;
  syncFrequency?: string;
}

export interface AnalyticsJobData {
  event: string;
  organizationId: string;
  category: "ai" | "agent" | "system";
  metadata?: Record<string, any>;
  conversationId?: string;
  userId?: string;
  agentId?: string;
  widgetId?: string;
  channel?: "widget" | "web" | "mobile" | "api" | "qr";
  occurredAt?: Date | string;
  eventVersion?: string;
}

// Shared ioredis client connection instance for BullMQ queues
const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Required by BullMQ
});

const defaultJobOptions = {
  attempts: 1,
  removeOnComplete: 100,
  removeOnFail: 50,
};

export const aiQueue = new Queue<AIJobData, void, string>("ai-processing", {
  connection: connection as any,
  defaultJobOptions,
});

export const ingestionQueue = new Queue<IngestionJobData, void, string>(
  "document-ingestion",
  { connection: connection as any, defaultJobOptions },
);

export const analyticsQueue = new Queue<AnalyticsJobData, void, string>(
  "platform-analytics",
  { connection: connection as any, defaultJobOptions },
);

export interface AnalyzerJobData {
  conversationId: string;
  organizationId: string;
}

export const analyzerQueue = new Queue<AnalyzerJobData, void, string>(
  "conversation-analyzer",
  { connection: connection as any, defaultJobOptions },
);

export interface AssistJobData {
  action: "suggest-reply" | "generate-note" | "draft-assist";
  requestId: string;
  userId: string;
  organizationId: string;
  conversationId: string;
  payload: {
    messages?: any[];
    contactName?: string;
    draft?: string;
    mode?: "variations" | "reframe";
  };
}

export const assistQueue = new Queue<AssistJobData, void, string>(
  "assist-processing",
  { connection: connection as any, defaultJobOptions },
);

export interface LeadSourceJobData {
  provider: "facebook_lead_ads" | "google_forms";
  submissionId: string;
}

export const leadSourceQueue = new Queue<LeadSourceJobData, void, string>(
  "lead-source-ingestion",
  {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  },
);
