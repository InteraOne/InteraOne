import mongoose, { Document, Schema, Types } from "mongoose";

export type ThreadDomainStatus =
  | "pending_dns"
  | "verified"
  | "provisioning"
  | "active"
  | "error";
export type ThreadDomainTlsStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "disabled"
  | "error";

export interface IThreadDomain extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  hostname: string;
  verificationToken: string;
  status: ThreadDomainStatus;
  tlsStatus: ThreadDomainTlsStatus;
  ownershipVerifiedAt?: Date;
  routingVerifiedAt?: Date;
  tlsVerifiedAt?: Date;
  lastCheckedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const threadDomainSchema = new Schema<IThreadDomain>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    hostname: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 253,
    },
    verificationToken: { type: String, required: true, maxlength: 128 },
    status: {
      type: String,
      enum: ["pending_dns", "verified", "provisioning", "active", "error"],
      default: "pending_dns",
    },
    tlsStatus: {
      type: String,
      enum: ["pending", "provisioning", "active", "disabled", "error"],
      default: "pending",
    },
    ownershipVerifiedAt: Date,
    routingVerifiedAt: Date,
    tlsVerifiedAt: Date,
    lastCheckedAt: Date,
    lastError: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

threadDomainSchema.index({ organizationId: 1, createdAt: -1 });
threadDomainSchema.index({ hostname: 1, status: 1 });

export const ThreadDomain = mongoose.model<IThreadDomain>(
  "ThreadDomain",
  threadDomainSchema,
);
