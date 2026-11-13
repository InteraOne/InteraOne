import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationSessionStatus = "active" | "closed" | "expired";

export interface IIntegrationSession extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  conversationId: Types.ObjectId;
  composioSessionId: string;
  policyHash: string;
  allowedMetaTools: string[];
  discoveredToolSlugs: string[];
  toolSchemas: Record<string, Record<string, unknown>>;
  status: IntegrationSessionStatus;
  executionCount: number;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const integrationSessionSchema = new Schema<IIntegrationSession>(
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
    composioSessionId: {
      type: String,
      required: true,
      maxlength: 256,
      select: false,
    },
    policyHash: { type: String, required: true, maxlength: 64 },
    allowedMetaTools: {
      type: [{ type: String, maxlength: 160 }],
      required: true,
      default: [],
    },
    discoveredToolSlugs: {
      type: [{ type: String, maxlength: 160 }],
      required: true,
      default: [],
    },
    toolSchemas: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
      select: false,
    },
    status: {
      type: String,
      enum: ["active", "closed", "expired"],
      default: "active",
      index: true,
    },
    executionCount: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true, index: true },
    lastUsedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

integrationSessionSchema.index(
  { organizationId: 1, conversationId: 1, status: 1 },
  {
    unique: true,
    name: "one_active_integration_session_per_conversation",
    partialFilterExpression: { status: "active" },
  },
);

export const IntegrationSession = mongoose.model<IIntegrationSession>(
  "IntegrationSession",
  integrationSessionSchema,
);
