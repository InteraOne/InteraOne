import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executing"
  | "executed"
  | "failed";

export interface IIntegrationToolApproval extends Document {
  organizationId: Types.ObjectId;
  requestedBy: Types.ObjectId;
  approvedBy?: Types.ObjectId | null;
  connectionId: Types.ObjectId;
  toolkitSlug: string;
  toolSlug: string;
  risk: "write" | "sensitive";
  arguments: Record<string, unknown>;
  argumentHash: string;
  status: IntegrationApprovalStatus;
  expiresAt: Date;
  decidedAt?: Date | null;
  executedAt?: Date | null;
  idempotencyKey: string;
  resultSummary?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const integrationToolApprovalSchema = new Schema<IIntegrationToolApproval>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    connectionId: { type: Schema.Types.ObjectId, ref: "IntegrationConnection", required: true },
    toolkitSlug: { type: String, required: true, lowercase: true, maxlength: 80 },
    toolSlug: { type: String, required: true, maxlength: 160 },
    risk: { type: String, enum: ["write", "sensitive"], required: true },
    arguments: { type: Schema.Types.Mixed, required: true },
    argumentHash: { type: String, required: true, maxlength: 64 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "expired", "executing", "executed", "failed"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    decidedAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    idempotencyKey: { type: String, required: true, unique: true, maxlength: 128 },
    resultSummary: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);

integrationToolApprovalSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

export const IntegrationToolApproval = mongoose.model<IIntegrationToolApproval>(
  "IntegrationToolApproval",
  integrationToolApprovalSchema,
);
