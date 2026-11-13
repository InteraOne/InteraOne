import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export interface IIntegrationApproval extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  conversationId: Types.ObjectId;
  sessionId: Types.ObjectId;
  executionId: Types.ObjectId;
  metaToolSlug: string;
  arguments: Record<string, unknown>;
  requestState?: string;
  inputRequests: Record<string, unknown>;
  status: IntegrationApprovalStatus;
  expiresAt: Date;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const integrationApprovalSchema = new Schema<IIntegrationApproval>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "IntegrationSession",
      required: true,
      index: true,
    },
    executionId: {
      type: Schema.Types.ObjectId,
      ref: "IntegrationExecution",
      required: true,
      unique: true,
    },
    metaToolSlug: { type: String, required: true, maxlength: 160 },
    arguments: { type: Schema.Types.Mixed, required: true },
    requestState: {
      type: String,
      maxlength: 16_384,
      select: false,
    },
    inputRequests: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "denied", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const IntegrationApproval = mongoose.model<IIntegrationApproval>(
  "IntegrationApproval",
  integrationApprovalSchema,
);
