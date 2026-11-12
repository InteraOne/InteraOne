import mongoose, { Document, Schema, Types } from "mongoose";
import { IOrganization } from "./Organization";

export type KnowledgeSource = "pdf" | "docx" | "text" | "url" | "faq";
export type KnowledgeStatus =
  | "pending"
  | "queued"
  | "indexing"
  | "indexed"
  | "failed";

export interface IKnowledge extends Document {
  organizationId: Types.ObjectId | IOrganization;
  title: string;
  description?: string;
  catalog?: string;
  source: KnowledgeSource;
  status: KnowledgeStatus;
  // File-based
  fileName?: string;
  fileKey?: string;
  fileSize?: number;
  mimeType?: string;
  // Text/URL/FAQ
  content?: string;
  sourceUrl?: string;
  sourceUrlNormalized?: string;
  // URL-sync options (only for source === "url")
  fetchMode?: "single" | "crawl";
  crawlDepth?: number;
  syncFrequency?: "manual" | "1hour" | "6hours" | "daily";
  // Indexing meta
  wordCount?: number;
  chunkCount?: number;
  lastIndexed?: Date;
  errorMessage?: string;
  // URL pause control
  isPaused?: boolean;
  // Ownership
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeSchema = new Schema<IKnowledge>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    catalog: { type: String, trim: true },
    source: {
      type: String,
      enum: ["pdf", "docx", "text", "url", "faq"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "queued", "indexing", "indexed", "failed"],
      default: "pending",
    },
    fileName: { type: String },
    fileKey: { type: String },
    fileSize: { type: Number },
    mimeType: { type: String },
    content: { type: String },
    sourceUrl: { type: String },
    sourceUrlNormalized: { type: String },
    fetchMode: { type: String, enum: ["single", "crawl"] },
    crawlDepth: { type: Number },
    syncFrequency: {
      type: String,
      enum: ["manual", "1hour", "6hours", "daily"],
    },
    wordCount: { type: Number },
    chunkCount: { type: Number },
    lastIndexed: { type: Date },
    errorMessage: { type: String },
    isPaused: { type: Boolean, default: false },
    uploadedBy: { type: String, required: true },
  },
  { timestamps: true },
);

KnowledgeSchema.index({ organizationId: 1, status: 1 });
KnowledgeSchema.index({ organizationId: 1, catalog: 1 });
KnowledgeSchema.index({ catalog: 1 });
KnowledgeSchema.index(
  { organizationId: 1, sourceUrlNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceUrlNormalized: { $type: "string" } },
  },
);

export const Knowledge = mongoose.model<IKnowledge>(
  "Knowledge",
  KnowledgeSchema,
);
