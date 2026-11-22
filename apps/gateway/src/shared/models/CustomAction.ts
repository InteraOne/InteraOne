import mongoose, { Document, Schema, Types } from "mongoose";

export type CustomActionMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type CustomActionAuthType = "none" | "bearer" | "basic" | "api_key";

export interface ICustomAction extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  category?: string;
  slug: string;
  description: string;
  enabled: boolean;
  audience?: "public" | "restricted" | "verified";
  integrationId?: Types.ObjectId;
  request: {
    method: CustomActionMethod;
    url: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    bodyTemplate?: unknown;
  };
  authentication: {
    type: CustomActionAuthType;
    placement?: "header" | "query";
    keyName?: string;
    encryptedCredentials?: string;
    credentialHint?: string;
  };
  inputSchema: Record<string, unknown>;
  confirmation: { mode: "never" | "always" };
  execution: { timeoutMs: number; maxResponseBytes: number };
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const customActionSchema = new Schema<ICustomAction>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, trim: true, maxlength: 80, default: undefined },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80, match: /^[a-z][a-z0-9_]*$/ },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    enabled: { type: Boolean, default: false, index: true },
    audience: { type: String, enum: ["public", "restricted", "verified"], default: "restricted" },
    integrationId: { type: Schema.Types.ObjectId, ref: "CustomActionIntegration" },
    request: {
      method: { type: String, enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], required: true },
      url: { type: String, required: true, maxlength: 2048 },
      headers: { type: Schema.Types.Mixed, default: {} },
      query: { type: Schema.Types.Mixed, default: {} },
      bodyTemplate: { type: Schema.Types.Mixed, default: undefined },
    },
    authentication: {
      type: { type: String, enum: ["none", "bearer", "basic", "api_key"], default: "none" },
      placement: { type: String, enum: ["header", "query"], default: undefined },
      keyName: { type: String, maxlength: 100, default: undefined },
      encryptedCredentials: { type: String, select: false, default: undefined },
      credentialHint: { type: String, maxlength: 32, default: undefined },
    },
    inputSchema: { type: Schema.Types.Mixed, required: true },
    confirmation: {
      mode: { type: String, enum: ["never", "always"], default: "never" },
    },
    execution: {
      timeoutMs: { type: Number, min: 1000, max: 15000, default: 10000 },
      maxResponseBytes: { type: Number, min: 1024, max: 131072, default: 32768 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

customActionSchema.index(
  { organizationId: 1, slug: 1 },
  { unique: true, name: "unique_custom_action_slug" },
);

export const CustomAction = mongoose.model<ICustomAction>("CustomAction", customActionSchema);
