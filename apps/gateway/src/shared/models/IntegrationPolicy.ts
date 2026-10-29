import mongoose, { Document, Schema, Types } from "mongoose";

export type IntegrationToolRisk = "read" | "write" | "sensitive";

export interface IIntegrationPolicy extends Document {
  organizationId: Types.ObjectId;
  toolkitSlug: string;
  enabled: boolean;
  allowedTools: Array<{ slug: string; risk: IntegrationToolRisk }>;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const integrationPolicySchema = new Schema<IIntegrationPolicy>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    toolkitSlug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    enabled: { type: Boolean, default: true },
    allowedTools: {
      type: [{
        slug: { type: String, required: true, trim: true, maxlength: 160 },
        risk: { type: String, enum: ["read", "write", "sensitive"], required: true },
      }],
      default: [],
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

integrationPolicySchema.index(
  { organizationId: 1, toolkitSlug: 1 },
  { unique: true, name: "unique_integration_policy" },
);

export const IntegrationPolicy = mongoose.model<IIntegrationPolicy>(
  "IntegrationPolicy",
  integrationPolicySchema,
);
