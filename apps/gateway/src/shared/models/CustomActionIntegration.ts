import mongoose, { Schema } from "mongoose";

export const CustomActionIntegration = mongoose.model("CustomActionIntegration", new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  origin: { type: String, required: true },
  authentication: { type: Schema.Types.Mixed, required: true, select: false },
}, { timestamps: true }));
