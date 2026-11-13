import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationExecutionStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "approval_required";

export interface IIntegrationExecution extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  conversationId: Types.ObjectId;
  sessionId: Types.ObjectId;
  executionKey: string;
  metaToolSlug: string;
  argumentHash: string;
  mutating: boolean;
  status: IntegrationExecutionStatus;
  result?: unknown;
  error?: string | null;
  providerLogId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const integrationExecutionSchema = new Schema<IIntegrationExecution>(
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
    executionKey: { type: String, required: true, maxlength: 64 },
    metaToolSlug: { type: String, required: true, maxlength: 160 },
    argumentHash: { type: String, required: true, maxlength: 64 },
    mutating: { type: Boolean, required: true },
    status: {
      type: String,
      enum: [
        "running",
        "succeeded",
        "failed",
        "uncertain",
        "approval_required",
      ],
      required: true,
      index: true,
    },
    result: { type: Schema.Types.Mixed },
    error: { type: String, default: null, maxlength: 1000 },
    providerLogId: { type: String, default: null, maxlength: 256 },
  },
  { timestamps: true },
);

integrationExecutionSchema.index(
  { sessionId: 1, executionKey: 1 },
  { unique: true, name: "unique_integration_session_execution" },
);

export const IntegrationExecution = mongoose.model<IIntegrationExecution>(
  "IntegrationExecution",
  integrationExecutionSchema,
);
