import mongoose, { Document, Schema, Types } from "mongoose";

export type CustomActionApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export interface ICustomActionApproval extends Document {
  organizationId: Types.ObjectId;
  conversationId: Types.ObjectId;
  actionId: Types.ObjectId;
  actionSlug: string;
  arguments: Record<string, unknown>;
  status: CustomActionApprovalStatus;
  expiresAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customActionApprovalSchema = new Schema<ICustomActionApproval>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    actionId: { type: Schema.Types.ObjectId, ref: "CustomAction", required: true, index: true },
    actionSlug: { type: String, required: true, maxlength: 80 },
    arguments: { type: Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, enum: ["pending", "approved", "denied", "expired"], default: "pending", index: true },
    expiresAt: { type: Date, required: true },
    resolvedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);

customActionApprovalSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

export const CustomActionApproval = mongoose.model<ICustomActionApproval>(
  "CustomActionApproval",
  customActionApprovalSchema,
);
