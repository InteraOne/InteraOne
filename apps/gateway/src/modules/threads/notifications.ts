import { ThreadParticipation } from "./participation";
import logger from "@shared/core/logger";
import { Organization } from "@shared/models/Organization";
import { enqueueRawEmail } from "@shared/queues/email.queue";
import { portalUrl } from "./domains";

type ThreadUpdate = {
  _id: unknown;
  organizationId: unknown;
  channel?: string;
  metadata: Record<string, any>;
};

export async function notifyThreadOwner(
  thread: ThreadUpdate,
  event: "reply" | "status" | "handoff",
) {
  if (thread.channel !== "threads") return;
  const recipient = thread.metadata?.thread?.notificationEmail;
  const followers = await ThreadParticipation.find({ organizationId: thread.organizationId, conversationId: thread._id, following: true }).select("notificationEmail").lean();
  const recipients = new Set<string>(typeof recipient === "string" ? [recipient] : []);
  for (const follower of followers) if (follower.notificationEmail) recipients.add(follower.notificationEmail);
  if (!recipients.size) return;
  try {
    const org = await Organization.findOne({
      _id: thread.organizationId,
      isActive: true,
      threadsEnabled: true,
    })
      .select("name slug")
      .lean();
    if (!org) return;

    const base = await portalUrl(thread.organizationId, org.slug);
    const url = new URL(
      base.includes(`/threads/${encodeURIComponent(org.slug)}`)
        ? `${base.replace(/\/$/, "")}/thread/${thread._id}`
        : `/thread/${thread._id}`,
      base,
    );
    const message = {
      reply: "There’s a new reply to your thread.",
      status: "The status of your thread has changed.",
      handoff: "Your thread is with the support team.",
    }[event];
    const subject = `${org.name.replace(/[\r\n]/g, " ")} Threads update`;
    for (const email of recipients) await enqueueRawEmail(
      email,
      subject,
      `<p>${message}</p><p><a href="${url.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Open your thread</a></p>`,
      `${message}\n\n${url.href}`,
    );
  } catch (error) {
    logger.error("Could not send Threads update", {
      error,
      conversationId: String(thread._id),
    });
  }
}
