import { Router, Request, Response } from "express";
import Joi from "joi";
import { Types } from "mongoose";
import {
  Conversation,
  Message,
  Organization,
  ThreadDomain,
} from "@shared/models";
import config from "@shared/infra/config";
import logger from "@shared/core/logger";
import { isEmailEnabled } from "@shared/utils/email";
import { AppError } from "@shared/core/errors";
import {
  authenticate,
  resolveOrganization,
  requireRole,
  AuthenticatedRequest,
  authRateLimit,
} from "@shared/security/middleware";
import { isQuotaExhausted } from "@shared/security/middleware/rate-limit";
import { aiQueue } from "@shared/infra/queue";
import { redisClient } from "@shared/infra/redis";
import { socketService } from "@sockets/services/socket.service";
import StorageService from "@modules/storage/storage.service";
import { categories, threadScope } from "./access";
import { challenge, login, session } from "./customer";
import { notifyThreadOwner } from "./notifications";
import { handoffThread } from "./handoff";
import { ThreadParticipation as Participation } from "./participation";
import {
  createDomain,
  domainDto,
  hostedPortalUrl,
  threadDomainTarget,
  normalizeThreadHostname,
  resolvePortalOrganization,
  verifyDomain,
} from "./domains";

const router = Router();
const settingsSchema = Joi.object({
  enabled: Joi.boolean().strict().required(),
  aiEnabled: Joi.boolean().strict().required(),
  title: Joi.string().trim().allow("").max(80).required(),
  logoUrl: Joi.string()
    .uri({ scheme: ["https", "http"] })
    .max(2048)
    .allow("")
    .required(),
  logoKey: Joi.string().trim().max(1024).allow("").optional(),
  accent: Joi.string()
    .pattern(/^#[0-9a-f]{6}$/i)
    .required(),
});
const missing = () => new AppError("Thread not found", 404);
const staffOrg = (req: Request) =>
  (req as AuthenticatedRequest).user.activeOrganizationId;
const publicLogo = (org: {
  threadsLogoKey?: string;
  threadsLogoUrl?: string;
}) =>
  org.threadsLogoKey
    ? `${config.app.apiUrl}/api/v1/storage/file?key=${encodeURIComponent(org.threadsLogoKey)}`
    : org.threadsLogoUrl || "";
function id(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value))
    throw missing();
  return value;
}
function summary(c: {
  _id: unknown;
  subject?: string;
  status: string;
  updatedAt: Date;
  metadata: Record<string, any>;
}) {
  return {
    id: String(c._id),
    title: c.subject,
    category: c.metadata.thread.category,
    public: c.metadata.thread.public === true,
    status: c.status,
    humanSupport:
      c.metadata.thread.category === "support" &&
      Boolean(c.metadata.escalatedAt || c.metadata.humanJoinedAt),
    acceptedReplyId: c.metadata.thread.acceptedReplyId,
    progress: c.metadata.thread.progress || "under_review",
    updatedAt: c.updatedAt,
  };
}
async function summaries(
  organizationId: string,
  rows: Parameters<typeof summary>[0][],
) {
  const features = rows.filter(
    (row) => row.metadata.thread.category === "feature",
  );
  const totals =
    features.length > 0
      ? await Participation.aggregate<{ _id: Types.ObjectId; count: number }>([
          {
            $match: {
              organizationId: new Types.ObjectId(organizationId),
              conversationId: {
                $in: features.map((row) => new Types.ObjectId(String(row._id))),
              },
              voted: true,
            },
          },
          { $group: { _id: "$conversationId", count: { $sum: 1 } } },
        ])
      : [];
  const votes = new Map(totals.map((row) => [String(row._id), row.count]));
  const activity = await Message.aggregate([
    {
      $match: {
        organizationId: new Types.ObjectId(organizationId),
        conversationId: {
          $in: rows.map((row) => new Types.ObjectId(String(row._id))),
        },
        type: "text",
        "metadata.source": { $in: ["threads", "web", "ai", "system"] },
        "metadata.deleted": { $ne: true },
      },
    },
    {
      $group: {
        _id: "$conversationId",
        count: { $sum: 1 },
        participants: {
          $addToSet: {
            id: "$senderId",
            name: "$metadata.senderName",
            source: "$metadata.source",
          },
        },
      },
    },
  ]);
  const counts = new Map(activity.map((row) => [String(row._id), row]));
  return rows.map((row) => {
    const activitySummary = counts.get(String(row._id));
    const profiles = new Map<
      string,
      { id: string; name: string; initials: string; source: string }
    >();
    for (const participant of activitySummary?.participants || []) {
      const participantId = String(participant.id || "unknown");
      if (profiles.has(participantId)) continue;
      const source = String(participant.source || "threads");
      const name =
        source === "ai"
          ? "AI assistant"
          : source === "web"
            ? participant.name || "Support team"
            : participant.name || "Community member";
      const initials = String(name)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");
      profiles.set(participantId, {
        id: participantId,
        name: String(name),
        initials: initials || "?",
        source,
      });
    }
    return {
      replyCount: Math.max(0, (activitySummary?.count || 0) - 1),
      participantCount: profiles.size,
      participantProfiles: Array.from(profiles.values()).slice(0, 4),
      ...summary(row),
      votes: votes.get(String(row._id)) ?? 0,
    };
  });
}

function search(q: unknown) {
  if (!q) return {};
  if (typeof q !== "string" || q.length > 100)
    throw new AppError("Search is too long", 400);
  return {
    subject: {
      $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    },
  };
}
function page(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 10000)
    throw new AppError("Invalid page", 400);
  return n;
}
router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/domain-allow", async (req, res) => {
  if (config.app.threads.tlsMode !== "on-demand") {
    res.sendStatus(403);
    return;
  }
  let hostname: string;
  try {
    hostname = normalizeThreadHostname(req.query.domain);
  } catch {
    res.sendStatus(403);
    return;
  }
  const allowed = await ThreadDomain.findOne({
    hostname,
    ownershipVerifiedAt: { $exists: true },
    status: { $in: ["verified", "provisioning", "active"] },
  })
    .select("organizationId")
    .lean();
  const organization = allowed
    ? await Organization.exists({
        _id: allowed.organizationId,
        isActive: true,
        threadsEnabled: true,
      })
    : await resolvePortalOrganization(hostname).catch(() => null);
  res.sendStatus(organization ? 200 : 403);
});
const manage = Router();
router.use(
  "/manage",
  authenticate,
  resolveOrganization,
  requireRole("admin"),
  manage,
);
manage.get("/", async (req, res) => {
  const organizationId = staffOrg(req);
  const category =
    typeof req.query.category === "string" ? req.query.category : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const visibility =
    typeof req.query.visibility === "string" ? req.query.visibility : "";
  const moderation = req.query.scope === "moderation";
  if (category && !categories.includes(category as (typeof categories)[number]))
    throw new AppError("Invalid thread category", 400);
  if (status && !["open", "resolved", "closed"].includes(status))
    throw new AppError("Invalid thread status", 400);
  if (visibility && !["public", "private"].includes(visibility))
    throw new AppError("Invalid thread visibility", 400);
  const baseScope = { organizationId, channel: "threads" };
  const listScope = {
    ...baseScope,
    ...search(req.query.q),
    ...(category ? { "metadata.thread.category": category } : {}),
    ...(status ? { status } : {}),
    ...(visibility
      ? { "metadata.thread.public": visibility === "public" }
      : {}),
    ...(moderation && !category
      ? { "metadata.thread.category": { $in: ["discussion", "feature"] } }
      : {}),
  };
  const org = await Organization.findById(staffOrg(req))
    .select(
      "name slug logoUrl threadsEnabled threadsAiEnabled threadsTitle threadsAccent threadsLogoUrl threadsLogoKey",
    )
    .lean();
  const [
    rows,
    resultCount,
    recentRows,
    total,
    open,
    openSupport,
    resolved,
    escalations,
    communityActivity,
    hidden,
    featureVotes,
  ] = await Promise.all([
    Conversation.find(listScope)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(page(req.query.page) * 30)
      .limit(30),
    Conversation.countDocuments(listScope),
    Conversation.find(baseScope).sort({ updatedAt: -1, _id: -1 }).limit(5),
    Conversation.countDocuments(baseScope),
    Conversation.countDocuments({ ...baseScope, status: "open" }),
    Conversation.countDocuments({
      ...baseScope,
      status: "open",
      "metadata.thread.category": "support",
    }),
    Conversation.countDocuments({ ...baseScope, status: "resolved" }),
    Conversation.countDocuments({
      ...baseScope,
      status: "open",
      "metadata.thread.category": "support",
      $or: [
        { "metadata.pendingEscalation": true },
        { "metadata.escalatedAt": { $exists: true } },
        { "metadata.humanJoinedAt": { $exists: true } },
      ],
    }),
    Conversation.countDocuments({
      ...baseScope,
      "metadata.thread.public": true,
      "metadata.thread.category": { $in: ["discussion", "feature"] },
    }),
    Conversation.countDocuments({
      ...baseScope,
      "metadata.thread.public": false,
      "metadata.thread.category": { $in: ["discussion", "feature"] },
    }),
    Participation.countDocuments({ organizationId, voted: true }),
  ]);
  res.json({
    slug: org?.slug,
    name: org?.name,
    logoUrl: org ? publicLogo(org) : "",
    logoKey: org?.threadsLogoKey || "",
    organizationLogoUrl: org?.logoUrl,
    title: org?.threadsTitle || "",
    accent: org?.threadsAccent || "#32685b",
    aiEnabled: org?.threadsAiEnabled === true,
    emailAvailable: isEmailEnabled(),
    enabled: org?.threadsEnabled === true,
    hostedUrl: org?.slug ? hostedPortalUrl(org.slug) : "",
    domainConfiguration: {
      available: Boolean(threadDomainTarget()),
      target: threadDomainTarget(),
      tlsMode: config.app.threads.tlsMode,
      mode: config.app.mode,
    },
    domains: (
      await ThreadDomain.find({ organizationId: staffOrg(req) })
        .sort({ createdAt: 1 })
        .lean()
    ).map(domainDto),
    overview: {
      total,
      open,
      openSupport,
      resolved,
      escalations,
      communityActivity,
      hidden,
      featureVotes,
    },
    resultCount,
    recentThreads: await summaries(organizationId, recentRows),
    threads: await summaries(staffOrg(req), rows),
  });
});
manage.patch("/", async (req, res) => {
  const { value, error } = settingsSchema.validate(req.body);
  if (error)
    throw new AppError("Check your portal settings and try again", 400);
  if (
    config.app.env === "production" &&
    value.logoUrl &&
    !value.logoUrl.startsWith("https://")
  )
    throw new AppError("Portal logos must use HTTPS", 400);
  if (
    value.logoKey &&
    !(await StorageService.verifyKeyOwnership(value.logoKey, staffOrg(req)))
  )
    throw new AppError(
      "The selected logo does not belong to this organization",
      403,
    );
  await Organization.updateOne(
    { _id: staffOrg(req), isActive: true },
    {
      $set: {
        threadsEnabled: value.enabled,
        threadsAiEnabled: value.aiEnabled,
        threadsTitle: value.title,
        threadsLogoUrl: value.logoUrl,
        threadsAccent: value.accent,
        ...(value.logoKey ? { threadsLogoKey: value.logoKey } : {}),
      },
      ...(!value.logoKey ? { $unset: { threadsLogoKey: 1 } } : {}),
    },
  );
  res.json({ success: true });
});
manage.post("/domains", async (req, res) => {
  const domain = await createDomain(staffOrg(req), req.body?.hostname);
  res.status(201).json(domainDto(domain));
});
manage.post("/domains/:id/verify", async (req, res) => {
  const domain = await verifyDomain(staffOrg(req), id(req.params.id));
  res.json(domainDto(domain));
});
manage.delete("/domains/:id", async (req, res) => {
  const removed = await ThreadDomain.deleteOne({
    _id: id(req.params.id),
    organizationId: staffOrg(req),
  });
  if (!removed.deletedCount) throw new AppError("Domain not found", 404);
  res.sendStatus(204);
});
manage.patch("/:id", async (req, res) => {
  const visibility = req.body?.public;
  const status = req.body?.status;
  const progress = req.body?.progress;
  const validStatus = ["open", "resolved", "closed"].includes(status);
  const validProgress = [
    "under_review",
    "planned",
    "in_progress",
    "shipped",
  ].includes(progress);
  if (
    (visibility !== undefined && typeof visibility !== "boolean") ||
    (status !== undefined && !validStatus) ||
    (progress !== undefined && !validProgress) ||
    (typeof visibility !== "boolean" && !validStatus && !validProgress)
  )
    throw new AppError("Choose a valid thread update", 400);
  const row = await Conversation.findOneAndUpdate(
    {
      _id: id(req.params.id),
      organizationId: staffOrg(req),
      channel: "threads",
      ...(typeof visibility === "boolean"
        ? { "metadata.thread.category": { $in: ["feature", "discussion"] } }
        : {}),
      ...(validProgress ? { "metadata.thread.category": "feature" } : {}),
    },
    {
      $set: {
        ...(typeof visibility === "boolean"
          ? { "metadata.thread.public": visibility }
          : {}),
        ...(validStatus ? { status } : {}),
        ...(validProgress ? { "metadata.thread.progress": progress } : {}),
      },
    },
    { new: true },
  );
  if (!row) throw missing();
  res.json(summary(row));
});
const portal = Router({ mergeParams: true });
router.use(
  "/host",
  async (req, res, next) => {
    const org = await resolvePortalOrganization(req.get("host"));
    if (!org) throw new AppError("Portal not found", 404);
    res.locals.org = org;
    next();
  },
  portal,
);
router.use("/p/:slug", portal);
portal.use(async (req, res, next) => {
  const org =
    res.locals.org ||
    (await Organization.findOne({
      slug: req.params.slug,
      isActive: true,
      threadsEnabled: true,
    })
      .select(
        "name slug logoUrl subscriptionStatus threadsTitle threadsAccent threadsAiEnabled threadsLogoUrl threadsLogoKey",
      )
      .lean());
  if (!org) throw new AppError("Portal not found", 404);
  res.locals.org = org;
  res.locals.orgId = String(org._id);
  res.locals.actor = await session(res.locals.orgId, req.get("Authorization"));
  next();
});
portal.get("/", (_req, res) => {
  const { name, slug, logoUrl, threadsTitle, threadsAccent } = res.locals.org;
  res.json({
    name,
    slug,
    logoUrl: publicLogo(res.locals.org) || logoUrl,
    title: threadsTitle || "Support & community",
    accent: threadsAccent || "#32685b",
  });
});
portal.post("/code", authRateLimit, async (req, res) => {
  await challenge(res.locals.orgId, res.locals.org.name, req.body?.email);
  res.sendStatus(204);
});
portal.post("/session", authRateLimit, async (req, res) => {
  res.json({
    token: await login(res.locals.orgId, req.body?.email, req.body?.code),
  });
});
portal.delete("/session", async (_req, res) => {
  if (res.locals.actor) await redisClient.del(res.locals.actor.key);
  res.sendStatus(204);
});
function signed(res: Response) {
  const actor = res.locals.actor as
    | NonNullable<Awaited<ReturnType<typeof session>>>
    | undefined;
  if (!actor) throw new AppError("Sign in to continue", 401);
  return actor;
}
portal.get("/threads", async (req, res) => {
  const engagement = req.query.engagement;
  if (engagement && !["upvoted", "following"].includes(String(engagement)))
    throw new AppError("Invalid engagement filter", 400);
  const actor = engagement ? signed(res) : res.locals.actor;
  const scope = threadScope(
    res.locals.orgId,
    req.query.mine === "1" ? actor?.owner : undefined,
    req.query.mine === "1",
  );
  const category = req.query.category;
  if (category && !categories.some((k) => k === category))
    throw new AppError("Invalid category", 400);
  const progress = req.query.progress;
  if (progress && !["under_review", "planned", "in_progress", "shipped"].includes(String(progress)))
    throw new AppError("Invalid progress", 400);
  const sort = req.query.sort || "latest";
  if (!["latest", "unanswered", "trending", "solved"].includes(String(sort)))
    throw new AppError("Invalid sorting", 400);
  const engagedThreads = engagement
    ? await Participation.find({
        organizationId: res.locals.orgId,
        owner: actor!.owner,
        [engagement === "upvoted" ? "voted" : "following"]: true,
      }).distinct("conversationId")
    : undefined;
  const scopeFilter = {
    ...scope,
    ...search(req.query.q),
    ...(engagedThreads ? { _id: { $in: engagedThreads } } : {}),
    ...(sort === "solved" ? { status: "resolved" } : {}),
    ...(category ? { $and: [{ "metadata.thread.category": category }] } : {}),
    ...(progress ? { "metadata.thread.progress": progress === "under_review" ? { $in: ["under_review", null] } : progress } : {}),
  };
  const rows = await Conversation.aggregate([
    {
      $match: {
        ...scopeFilter,
        organizationId: new Types.ObjectId(res.locals.orgId),
      },
    },
    {
      $lookup: {
        from: Message.collection.name,
        let: { conversation: "$_id", org: "$organizationId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conversationId", "$$conversation"] },
                  { $eq: ["$organizationId", "$$org"] },
                ],
              },
              ...publicMessages,
              "metadata.deleted": { $ne: true },
            },
          },
          { $count: "count" },
        ],
        as: "activity",
      },
    },
    {
      $lookup: {
        from: Participation.collection.name,
        let: { conversation: "$_id", org: "$organizationId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$conversationId", "$$conversation"] },
                  { $eq: ["$organizationId", "$$org"] },
                ],
              },
              voted: true,
            },
          },
          { $count: "count" },
        ],
        as: "voteActivity",
      },
    },
    {
      $addFields: {
        messageCount: {
          $ifNull: [{ $arrayElemAt: ["$activity.count", 0] }, 0],
        },
        voteCount: {
          $ifNull: [{ $arrayElemAt: ["$voteActivity.count", 0] }, 0],
        },
      },
    },
    ...(sort === "unanswered"
      ? [{ $match: { messageCount: { $lte: 1 }, status: "open" } }]
      : []),
    {
      $sort:
        sort === "trending"
          ? { voteCount: -1, messageCount: -1, updatedAt: -1, _id: -1 }
          : { updatedAt: -1, _id: -1 },
    },
    { $skip: page(req.query.page) * 30 },
    { $limit: 30 },
  ]);
  const result = await summaries(res.locals.orgId, rows);
  const viewerVotes = actor
    ? await Participation.find({
        organizationId: res.locals.orgId,
        owner: actor.owner,
        conversationId: { $in: rows.map((row) => row._id) },
        voted: true,
      })
        .select("conversationId")
        .lean()
    : [];
  const votedIds = new Set(
    viewerVotes.map((vote) => String(vote.conversationId)),
  );
  res.json(
    result.map((thread) => ({
      ...thread,
      voted: votedIds.has(thread.id),
    })),
  );
});
portal.get("/similar", async (req, res) => {
  if (typeof req.query.title !== "string")
    throw new AppError("Enter a title to find similar threads", 400);
  const title = req.query.title.trim().slice(0, 180);
  const terms = Array.from(
    new Set(
      title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 3),
    ),
  ).slice(0, 8);
  if (terms.length < 2) return res.json([]);
  const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await Conversation.find({
    ...threadScope(res.locals.orgId, res.locals.actor?.owner),
    $or: terms.map((term) => ({
      subject: { $regex: escape(term), $options: "i" },
    })),
  })
    .sort({ status: -1, updatedAt: -1 })
    .limit(20);
  const normalized = new Set(terms);
  const ranked = rows
    .map((row) => ({
      row,
      score: String(row.subject || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .reduce((score, word) => score + (normalized.has(word) ? 1 : 0), 0),
    }))
    .filter(({ score }) => score >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime(),
    )
    .slice(0, 4)
    .map(({ row }) => row);
  res.json(await summaries(res.locals.orgId, ranked));
});
portal.get("/updates", async (_req, res) => {
  const actor = signed(res);
  const read = await Participation.find({
    organizationId: res.locals.orgId,
    owner: actor.owner,
    $or: [{ seenAt: { $exists: true } }, { following: true }],
  })
    .sort({ seenAt: -1 })
    .limit(100)
    .lean();
  const rows = await Conversation.find({
    ...threadScope(res.locals.orgId, actor.owner),
    _id: { $in: read.map((r) => r.conversationId) },
  }).sort({ updatedAt: -1 });
  const times = new Map(read.map((r) => [String(r.conversationId), r.seenAt!]));
  res.json(
    rows
      .filter((r) => r.updatedAt > (times.get(String(r._id)) || new Date(0)))
      .map(summary),
  );
});
async function readable(req: Request, res: Response) {
  const row = await Conversation.findOne({
    ...threadScope(res.locals.orgId, res.locals.actor?.owner),
    _id: id(req.params.id),
  });
  if (!row) throw missing();
  return row;
}
const publicMessages = {
  type: "text",
  "metadata.source": { $in: ["threads", "web", "ai", "system"] },
};
const reactionEmojis = [
  "👍",
  "❤️",
  "😀",
  "😂",
  "😢",
  "🙏",
  "👎",
  "😡",
  "🎉",
  "🔥",
  "👏",
  "🤔",
  "😍",
  "🚀",
  "👀",
  "💯",
] as const;
function reactions(message: { metadata: Record<string, any> }, owner?: string) {
  const stored = message.metadata.reactions;
  if (!stored || typeof stored !== "object") return [];
  return reactionEmojis.flatMap((emoji) => {
    const owners = Array.isArray(stored[emoji])
      ? stored[emoji].filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];
    return owners.length
      ? [
          {
            emoji,
            count: new Set(owners).size,
            reacted: Boolean(owner && owners.includes(owner)),
          },
        ]
      : [];
  });
}
portal.get("/threads/:id", async (req, res) => {
  const row = await readable(req, res);
  const filter = { organizationId: res.locals.orgId, conversationId: row._id };
  const messages = await Message.find({
    ...filter,
    ...publicMessages,
    ...(req.query.before ? { _id: { $lt: id(req.query.before) } } : {}),
  })
    .sort({ _id: -1 })
    .limit(51);
  const opening = await Message.findOne({ ...filter, ...publicMessages }).sort({
    _id: 1,
  });
  const more = messages.length > 50;
  const actor = res.locals.actor;
  const shown = messages.slice(0, 50).reverse();
  const replyToIds = shown
    .map((message) => message.metadata.replyToId)
    .filter((replyToId): replyToId is string => typeof replyToId === "string");
  const referenced = replyToIds.length
    ? await Message.find({
        ...filter,
        ...publicMessages,
        _id: { $in: replyToIds },
      })
    : [];
  const referencedById = new Map(
    referenced.map((message) => [message.id, message]),
  );
  const author = (message: (typeof shown)[number]) =>
    message.metadata.source === "threads"
      ? message.senderId === actor?.owner
        ? "You"
        : message.metadata.senderName || "Community member"
      : message.metadata.source === "ai"
        ? "AI assistant"
        : "Support team";
  const key = { ...filter, owner: actor?.owner };
  const participation = actor && (await Participation.findOne(key));
  if (actor && !req.query.before)
    await Participation.updateOne(
      key,
      { $max: { seenAt: row.updatedAt } },
      { upsert: true },
    );
  const [thread] = await summaries(res.locals.orgId, [row]);
  res.json({
    ...thread,
    more,
    voted: !!participation?.voted,
    following: !!participation?.following,
    canManage: row.metadata.thread.owner === actor?.owner,
    opening: opening
      ? {
          id: opening.id,
          text: opening.content,
          attachments: opening.metadata.attachments || [],
          reactions: reactions(opening, actor?.owner),
          at: opening.createdAt,
          author:
            opening.metadata.source === "threads" &&
            opening.senderId === actor?.owner
              ? "You"
              : opening.metadata.senderName || "Community member",
        }
      : null,
    messages: shown.map((m) => {
      const replyTo = referencedById.get(m.metadata.replyToId);
      return {
        id: m.id,
        text: m.metadata.deleted ? "This reply was deleted." : m.content,
        own: m.metadata.source === "threads" && m.senderId === actor?.owner,
        deleted: !!m.metadata.deleted,
        edited: !!m.metadata.edited,
        reactions: reactions(m, actor?.owner),
        ...(replyTo && {
          replyTo: {
            id: replyTo.id,
            text: replyTo.metadata.deleted
              ? "This reply was deleted."
              : replyTo.content,
            author: author(replyTo),
            deleted: !!replyTo.metadata.deleted,
          },
        }),
        attachments: m.metadata.deleted ? [] : m.metadata.attachments || [],
        at: m.createdAt,
        author: author(m),
      };
    }),
  });
});
portal.post("/attachments", async (req, res) => {
  const actor = signed(res);
  const { error, value } = Joi.object({
    fileName: Joi.string().max(180).required(),
    mimeType: Joi.string()
      .valid(
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
        "text/plain",
        "application/zip",
      )
      .required(),
    size: Joi.number()
      .integer()
      .min(1)
      .max(10 * 1024 * 1024)
      .required(),
  }).validate(req.body);
  if (error)
    throw new AppError(
      "Choose a PNG, JPEG, WebP, PDF, text or ZIP file up to 10 MB",
      400,
    );
  const upload = await StorageService.generateConversationUploadUrl(
    value.fileName,
    value.mimeType,
    res.locals.orgId,
  );
  await redisClient.set(
    "threads:upload:" +
      res.locals.orgId +
      ":" +
      actor.owner +
      ":" +
      upload.fileKey,
    JSON.stringify({ name: value.fileName, key: upload.fileKey }),
    { EX: 3600 },
  );
  res.json({
    uploadUrl: upload.uploadUrl,
    key: upload.fileKey,
    name: value.fileName,
  });
});
portal.get("/threads/:id/attachments", async (req, res) => {
  const row = await readable(req, res);
  if (typeof req.query.key !== "string") throw missing();
  const exists = await Message.exists({
    organizationId: res.locals.orgId,
    conversationId: row._id,
    ...publicMessages,
    "metadata.deleted": { $ne: true },
    "metadata.attachments.key": req.query.key,
  });
  if (!exists) throw missing();
  res.json({
    url: await StorageService.generatePresignedDownloadUrl(req.query.key, 300),
  });
});
portal.put("/threads/:id/solution", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  if (row.metadata.thread.owner !== actor.owner)
    throw new AppError("Only the thread author can accept a solution", 403);
  const message = await Message.findOne({
    _id: id(req.body?.replyId),
    organizationId: res.locals.orgId,
    conversationId: row._id,
    ...publicMessages,
    "metadata.deleted": { $ne: true },
  });
  if (!message) throw missing();
  await Conversation.updateOne(
    { _id: row._id, organizationId: res.locals.orgId },
    {
      $set: {
        "metadata.thread.acceptedReplyId": message.id,
        status: "resolved",
      },
    },
  );
  res.sendStatus(204);
});
portal.put("/threads/:id/follow", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  if (typeof req.body?.following !== "boolean")
    throw new AppError("Invalid follow preference", 400);
  await Participation.updateOne(
    {
      organizationId: res.locals.orgId,
      conversationId: row._id,
      owner: actor.owner,
    },
    { $set: { following: req.body.following, notificationEmail: actor.email } },
    { upsert: true },
  );
  res.sendStatus(204);
});
portal.patch("/threads/:id/replies/:replyId", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  const { error, value } = Joi.object({
    text: Joi.string().trim().max(12000).required(),
  }).validate(req.body);
  if (error) throw new AppError("Enter a reply up to 12000 characters", 400);
  const message = await Message.findOneAndUpdate(
    {
      _id: id(req.params.replyId),
      organizationId: res.locals.orgId,
      conversationId: row._id,
      senderId: actor.owner,
      "metadata.source": "threads",
      "metadata.deleted": { $ne: true },
    },
    { $set: { content: value.text, "metadata.edited": true } },
  );
  if (!message) throw missing();
  res.sendStatus(204);
});
portal.delete("/threads/:id/replies/:replyId", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  const opening = await Message.findOne({
    organizationId: res.locals.orgId,
    conversationId: row._id,
    ...publicMessages,
  }).sort({ _id: 1 });
  if (String(opening?._id) === req.params.replyId)
    throw new AppError("The original post cannot be deleted here", 400);
  const message = await Message.findOneAndUpdate(
    {
      _id: id(req.params.replyId),
      organizationId: res.locals.orgId,
      conversationId: row._id,
      senderId: actor.owner,
      "metadata.source": "threads",
    },
    { $set: { content: "This reply was deleted.", "metadata.deleted": true } },
  );
  if (!message) throw missing();
  await Conversation.updateOne(
    {
      _id: row._id,
      organizationId: res.locals.orgId,
      "metadata.thread.acceptedReplyId": req.params.replyId,
    },
    { $unset: { "metadata.thread.acceptedReplyId": "" } },
  );
  res.sendStatus(204);
});
portal.post("/threads/:id/replies/:replyId/report", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  const message = await Message.findOneAndUpdate(
    {
      _id: id(req.params.replyId),
      organizationId: res.locals.orgId,
      conversationId: row._id,
    },
    { $addToSet: { "metadata.reportedBy": actor.owner } },
  );
  if (!message) throw missing();
  res.sendStatus(204);
});
portal.put("/threads/:id/messages/:messageId/reactions", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  const { error, value } = Joi.object({
    emoji: Joi.string()
      .valid(...reactionEmojis)
      .required(),
    reacted: Joi.boolean().strict().required(),
  }).validate(req.body);
  if (error) throw new AppError("Choose a supported reaction", 400);
  const path = `metadata.reactions.${value.emoji}`;
  const message = await Message.updateOne(
    {
      _id: id(req.params.messageId),
      organizationId: res.locals.orgId,
      conversationId: row._id,
      ...publicMessages,
      "metadata.deleted": { $ne: true },
    },
    value.reacted
      ? { $addToSet: { [path]: actor.owner } }
      : { $pull: { [path]: actor.owner } },
  );
  if (!message.matchedCount) throw missing();
  res.sendStatus(204);
});
portal.put("/threads/:id/vote", async (req, res) => {
  const actor = signed(res),
    row = await readable(req, res);
  if (
    row.metadata.thread.category !== "feature" ||
    !row.metadata.thread.public ||
    typeof req.body?.voted !== "boolean"
  )
    throw new AppError("Voting is unavailable", 400);
  await Participation.updateOne(
    {
      organizationId: res.locals.orgId,
      conversationId: row._id,
      owner: actor.owner,
    },
    { $set: { voted: req.body.voted } },
    { upsert: true },
  );
  res.sendStatus(204);
});
const bodySchema = Joi.object({
  text: Joi.string().trim().max(12000).required(),
  attachments: Joi.array().items(Joi.string().max(1024)).max(5).default([]),
  replyToId: Joi.string().hex().length(24).optional(),
});
const createSchema = bodySchema.keys({
  title: Joi.string().trim().max(180).required(),
  category: Joi.string()
    .valid(...categories)
    .required(),
});
async function post(req: Request, res: Response, create: boolean) {
  const actor = signed(res),
    org = res.locals.orgId;
  const { error, value } = (create ? createSchema : bodySchema).validate(
    req.body,
  );
  if (error || !value)
    throw new AppError("Check the thread fields and try again", 400);
  if (create && value.replyToId)
    throw new AppError("A new thread cannot reply to another message", 400);
  const row = create
    ? new Conversation({
        organizationId: org,
        channel: "threads",
        sessionId: actor.sessionId,
        subject: value.title,
        metadata: {
          source: "threads",
          contactId: actor.contactId,
          linkedContactId: actor.contactId,
          customer: {
            name: actor.name,
            email: actor.email,
            startedAt: new Date(),
          },
          ...(value.category === "support" &&
            !res.locals.org.threadsAiEnabled && {
              escalatedAt: new Date(),
              pendingEscalation: true,
            }),
          thread: {
            owner: actor.owner,
            notificationEmail: actor.email,
            category: value.category,
            public: value.category !== "support",
          },
        },
      })
    : await readable(req, res);
  if (row.status !== "open")
    throw new AppError("This thread is closed to replies", 409);
  const replyTo =
    !create && value.replyToId
      ? await Message.findOne({
          _id: id(value.replyToId),
          organizationId: org,
          conversationId: row._id,
          ...publicMessages,
        })
      : null;
  if (!create && value.replyToId && !replyTo)
    throw new AppError("The message you are replying to is unavailable", 400);
  // Claim an accepting conversation before publishing a reply.
  if (!create) {
    const touched = await Conversation.updateOne(
      { ...threadScope(org, actor.owner), _id: row._id, status: "open" },
      { $currentDate: { updatedAt: true } },
    );
    if (!touched.matchedCount)
      throw new AppError("Thread no longer accepts replies", 409);
  }
  const attachments = await Promise.all(
    (value.attachments || []).map(async (key: string) => {
      const grant = await redisClient.get(
        "threads:upload:" + org + ":" + actor.owner + ":" + key,
      );
      if (!grant)
        throw new AppError("Attachment expired. Upload it again", 400);
      return JSON.parse(grant);
    }),
  );
  const message = await Message.create({
    organizationId: org,
    conversationId: row._id,
    senderId: actor.owner,
    type: "text",
    content: value.text,
    metadata: {
      source: "threads",
      senderName: actor.name,
      attachments,
      ...(replyTo && { replyToId: replyTo.id }),
    },
  });
  if (create) {
    // The opening message is inaccessible until the conversation exists.
    try {
      await row.save();
    } catch (error) {
      if (!(await Conversation.exists({ _id: row._id, organizationId: org })))
        await Message.deleteOne({ _id: message._id, organizationId: org });
      throw error;
    }
  } else {
    await Conversation.updateOne(
      { _id: row._id, organizationId: org },
      { $max: { updatedAt: message.createdAt } },
      { timestamps: false },
    );
  }
  await Participation.updateOne(
    { organizationId: org, conversationId: row._id, owner: actor.owner },
    {
      $max: {
        seenAt:
          row.updatedAt > message.createdAt ? row.updatedAt : message.createdAt,
      },
    },
    { upsert: true },
  ).catch((error) =>
    logger.warn("Could not record Threads participation", {
      error,
      conversationId: row.id,
    }),
  );
  if (!create) void notifyThreadOwner(row, "reply");
  socketService.emitToConversation(row.id, "new_message", {
    conversationId: row.id,
    message: {
      _id: message.id,
      content: message.content,
      type: "text",
      senderId: actor.owner,
      metadata: message.metadata,
      createdAt: message.createdAt,
    },
  });
  if (
    row.metadata.thread.category === "support" &&
    !row.assignedTo &&
    !row.metadata.escalatedAt &&
    !row.metadata.humanJoinedAt
  ) {
    let queued = false;
    try {
      if (
        res.locals.org.threadsAiEnabled &&
        (!res.locals.org.subscriptionStatus ||
          res.locals.org.subscriptionStatus === "active") &&
        !(await isQuotaExhausted(org))
      ) {
        await aiQueue.add(
          "process",
          {
            organizationId: org,
            conversationId: row.id,
            messageId: message.id,
            content: value.text,
            companyName: res.locals.org.name,
            aiEnabled: true,
            channel: "threads",
            fallbackToAgent: true,
          },
          { jobId: message.id },
        );
        queued = true;
      }
    } catch (error) {
      logger.error("Could not enqueue Threads AI reply", {
        error,
        conversationId: row.id,
      });
    } finally {
      if (!queued) await handoffThread(org, row.id, "AI support unavailable");
    }
  }
  socketService.emitToOrg(org, "thread_activity", { conversationId: row.id });
  if (create)
    socketService.emitToOrg(org, "conversation_pending", {
      conversationId: row.id,
    });
  res.status(201).json({ id: row.id });
}
portal.post("/threads", (req, res) => post(req, res, true));
portal.post("/threads/:id/replies", (req, res) => post(req, res, false));
portal.post("/threads/:id/escalate", async (req, res) => {
  const actor = signed(res);
  const row = await readable(req, res);
  if (
    row.metadata.thread.owner !== actor.owner ||
    row.metadata.thread.category !== "support"
  )
    throw missing();
  if (row.status !== "open")
    throw new AppError("This thread is closed to replies", 409);
  await handoffThread(
    res.locals.orgId,
    row.id,
    "Customer requested the support team",
  );
  res.sendStatus(204);
});

portal.patch("/threads/:id/status", async (req, res) => {
  const actor = signed(res);
  const desired = req.body?.status;
  if (desired !== "open" && desired !== "resolved")
    throw new AppError("Invalid thread status", 400);
  const row = await readable(req, res);
  if (
    row.metadata.thread.owner !== actor.owner ||
    row.metadata.thread.category !== "support"
  )
    throw missing();
  if (row.status === "closed")
    throw new AppError("This thread was closed by the team", 409);
  if (row.status !== desired) {
    const changed = await Conversation.updateOne(
      { _id: row._id, organizationId: res.locals.orgId, status: row.status },
      { $set: { status: desired } },
    );
    if (!changed.modifiedCount)
      throw new AppError("The thread status has changed", 409);
    const event = { conversationId: row.id, status: desired };
    socketService.emitToConversation(row.id, "status_updated", event);
    socketService.emitToOrg(res.locals.orgId, "status_updated", event);
  }
  res.sendStatus(204);
});
export default router;
