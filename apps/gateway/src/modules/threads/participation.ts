import { Schema, model } from "mongoose";

const schema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  conversationId: { type: Schema.Types.ObjectId, required: true },
  owner: { type: String, required: true },
  seenAt: Date,
  notificationEmail: String,
  following: { type: Boolean, default: false },
  voted: { type: Boolean, default: false },
});
schema.index(
  { organizationId: 1, owner: 1, conversationId: 1 },
  { unique: true },
);
schema.index({ organizationId: 1, conversationId: 1, voted: 1 });
export const ThreadParticipation = model("ThreadParticipation", schema);
