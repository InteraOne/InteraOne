import { AppError } from "@shared/core/errors";

export const categories = ["support", "discussion", "feature"] as const;
export type Category = (typeof categories)[number];

export function threadScope(
  organizationId: string,
  owner?: string,
  mine = false,
) {
  const base = { organizationId, channel: "threads" };
  if (mine && !owner) throw new AppError("Sign in to view your threads", 401);
  if (mine) return { ...base, "metadata.thread.owner": owner };
  const shared = {
    "metadata.thread.public": true,
    "metadata.thread.category": { $in: ["discussion", "feature"] },
  };
  return owner
    ? { ...base, $or: [shared, { "metadata.thread.owner": owner }] }
    : { ...base, ...shared };
}
