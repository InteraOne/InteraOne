import mongoose, { Document, Schema, Types } from "mongoose";
import { IOrganization } from "./Organization";
import { redisClient } from "../infra/redis";

export interface IConversation extends Document {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId | IOrganization;
  participants: Types.ObjectId[];
  subject?: string;
  status: "open" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo?: Types.ObjectId | null;
  tags: string[];
  createdBy: Types.ObjectId;
  closedAt?: Date;
  metadata: Record<string, any>;
  channelId?: Types.ObjectId;
  channel?: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    subject: { type: String, maxlength: 200 },
    status: { type: String, enum: ["open", "resolved", "closed"], default: "open" },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    tags: [{ type: String, trim: true }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    closedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    channelId: { type: Schema.Types.ObjectId, ref: "Channel" },
    channel: { type: String, trim: true },
    sessionId: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

conversationSchema.index({ organizationId: 1, status: 1 });
conversationSchema.index({ organizationId: 1, assignedTo: 1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ organizationId: 1, updatedAt: -1 });
conversationSchema.index({ organizationId: 1, channelId: 1 });
conversationSchema.index({ organizationId: 1, channel: 1 });
conversationSchema.index(
  { organizationId: 1, "metadata.thread.owner": 1, updatedAt: -1 },
  { partialFilterExpression: { channel: "threads" } },
);
conversationSchema.index(
  { organizationId: 1, "metadata.thread.public": 1, updatedAt: -1 },
  { partialFilterExpression: { channel: "threads" } },
);

function clearConversationCache(id: any) {
  if (id) {
    const idStr = id.toString();
    redisClient.del([`conversation:${idStr}:gate`, `ai:conversation:${idStr}`]).catch(() => {});
  }
}

conversationSchema.post("save", function (doc) {
  clearConversationCache(doc?._id);
});

conversationSchema.post("updateOne", function (this: any) {
  const query = this.getQuery();
  clearConversationCache(query?._id);
});

conversationSchema.post("findOneAndUpdate", function (this: any) {
  const query = this.getQuery();
  clearConversationCache(query?._id);
});

export const Conversation = mongoose.model<IConversation>(
  "Conversation",
  conversationSchema,
);
