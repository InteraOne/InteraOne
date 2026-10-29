import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationConnectionStatus =
  | "pending"
  | "active"
  | "expired"
  | "disconnected"
  | "error";

export interface IIntegrationConnection extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  createdBy: Types.ObjectId;
  composioUserId: string;
  toolkitSlug: string;
  connectedAccountId: string;
  status: IntegrationConnectionStatus;
  displayLabel?: string | null;
  lastError?: string | null;
  disconnectedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const integrationConnectionSchema = new Schema<IIntegrationConnection>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    composioUserId: { type: String, required: true, maxlength: 256, select: false },
    toolkitSlug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    connectedAccountId: { type: String, required: true, trim: true, maxlength: 256 },
    status: {
      type: String,
      enum: ["pending", "active", "expired", "disconnected", "error"],
      default: "pending",
      index: true,
    },
    displayLabel: { type: String, default: null, trim: true, maxlength: 160 },
    lastError: { type: String, default: null, maxlength: 500 },
    disconnectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

integrationConnectionSchema.index(
  { organizationId: 1, createdBy: 1, toolkitSlug: 1, connectedAccountId: 1 },
  { unique: true, name: "unique_integration_connection" },
);
integrationConnectionSchema.index({ organizationId: 1, toolkitSlug: 1, status: 1 });

export const IntegrationConnection = mongoose.model<IIntegrationConnection>(
  "IntegrationConnection",
  integrationConnectionSchema,
);
