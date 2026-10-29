import mongoose, { Document, Schema, Types } from "mongoose";

export interface IIntegrationAuditEvent extends Document {
  organizationId: Types.ObjectId;
  actorUserId?: Types.ObjectId | null;
  connectionId?: Types.ObjectId | null;
  approvalId?: Types.ObjectId | null;
  eventType: string;
  toolkitSlug?: string;
  toolSlug?: string;
  success: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const integrationAuditEventSchema = new Schema<IIntegrationAuditEvent>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    connectionId: { type: Schema.Types.ObjectId, ref: "IntegrationConnection", default: null },
    approvalId: { type: Schema.Types.ObjectId, ref: "IntegrationToolApproval", default: null },
    eventType: { type: String, required: true, maxlength: 80, index: true },
    toolkitSlug: { type: String, maxlength: 80 },
    toolSlug: { type: String, maxlength: 160 },
    success: { type: Boolean, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

integrationAuditEventSchema.index({ organizationId: 1, createdAt: -1 });

export const IntegrationAuditEvent = mongoose.model<IIntegrationAuditEvent>(
  "IntegrationAuditEvent",
  integrationAuditEventSchema,
);
