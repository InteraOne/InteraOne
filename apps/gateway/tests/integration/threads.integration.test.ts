import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import {
  Contact,
  Conversation,
  Membership,
  Organization,
  ThreadDomain,
  User,
} from "@shared/models";
import config from "@shared/infra/config";
import { redisClient } from "@shared/infra/redis";
import { errorHandler } from "@shared/security/middleware";
import router from "@modules/threads/threads.routes";
import conversationRouter from "@modules/conversation/conversation.routes";
import { generateTokens } from "@shared/security/auth/jwt";
import { handleAgentMessage } from "@sockets/handlers/agent.handler";
import { socketService } from "@sockets/services/socket.service";
import { gatekeeperMiddleware } from "@sockets/middleware/gatekeeper";

const { deliver, queue } = vi.hoisted(() => ({
  queue: vi.fn(async () => undefined),
  deliver: vi.fn(
    async (_email: string, _subject: string, _html: string) => true,
  ),
}));
vi.mock("@shared/queues/email.queue", () => ({
  enqueueRawEmail: deliver,
}));
vi.mock("@shared/infra/queue", () => ({
  aiQueue: { add: queue },
  analyticsQueue: { add: vi.fn(async () => undefined) },
}));
vi.mock("@shared/security/middleware/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isQuotaExhausted: vi.fn(async () => false),
}));

describe.skipIf(!process.env.THREADS_TEST_MONGO)(
  "Threads HTTP workflow",
  () => {
    const app = express()
      .use(express.json())
      .use("/threads", router)
      .use("/conversations", conversationRouter)
      .use(errorHandler);
    const base = "/threads/p/first";
    const secret = "threads-integration-test";
    let organizationId: string;
    let owner: string;
    let agent: string;
    let agentId: string;
    beforeAll(async () => {
      await mongoose.connect(process.env.THREADS_TEST_MONGO!, {
        dbName: "threads_test_" + randomUUID().replaceAll("-", ""),
      });
      await redisClient.connect();
      vi.stubEnv("AI_TOOL_SECRET", secret);
      config.app.apiUrl = "https://portals.interaone.test";
      config.app.threads.tlsMode = "disabled";
      const [first] = await Organization.create([
        { name: "First", slug: "first", threadsEnabled: true },
        { name: "Second", slug: "second", threadsEnabled: true },
      ]);
      organizationId = first.id;
      const [founder, teammate] = await User.create([
        {
          name: "Founder",
          email: "founder@example.test",
          password: "test-password",
        },
        {
          name: "Teammate",
          email: "agent@example.test",
          password: "test-password",
        },
      ]);
      agentId = teammate.id;
      await Membership.create([
        {
          organizationId,
          userId: founder._id,
          inviteStatus: "accepted",
          role: "owner",
        },
        {
          organizationId,
          userId: teammate._id,
          inviteStatus: "accepted",
          role: "agent",
        },
      ]);
      owner =
        "Bearer " +
        generateTokens({
          userId: founder.id,
          email: founder.email,
          activeOrganizationId: organizationId,
        }).accessToken;
      agent =
        "Bearer " +
        generateTokens({
          userId: teammate.id,
          email: teammate.email,
          activeOrganizationId: organizationId,
        }).accessToken;
      socketService.init({ to: () => ({ emit: vi.fn() }) } as never);
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      if (mongoose.connection.readyState === 1)
        await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      if (redisClient.isOpen) await redisClient.quit();
    });
    async function sign(email: string) {
      await request(app)
        .post(base + "/code")
        .send({ email })
        .expect(204);
      const code = deliver.mock.calls
        .at(-1)![2]
        .match(/<strong>([0-9]{6})<\/strong>/)![1];
      const r = await request(app)
        .post(base + "/session")
        .send({ email, code })
        .expect(200);
      await request(app)
        .post(base + "/session")
        .send({ email, code })
        .expect(401);
      return "Bearer " + r.body.token;
    }
    it("finds all visible threads with a displayed reference across pages", async () => {
      const portal = await Organization.create({
        name: "Search",
        slug: "search",
        threadsEnabled: true,
      });
      const path = "/threads/p/search/threads";
      const thread = (id: string, title: string, shared = true) => ({
        _id: new mongoose.Types.ObjectId(id),
        organizationId: portal._id,
        channel: "threads",
        sessionId: id,
        subject: title,
        metadata: { thread: { public: shared, category: "discussion" } },
      });
      const first = thread("100000000000000000000abc", "Delivery [details]");
      const second = thread("200000000000000000000abc", "Find receipt");
      await Conversation.insertMany([
        first,
        second,
        thread("300000000000000000000abc", "Private", false),
        {
          ...thread("400000000000000000000abc", "Other workspace"),
          organizationId: new mongoose.Types.ObjectId(),
        },
      ]);
      await Conversation.insertMany(
        Array.from({ length: 30 }, (_, i) =>
          thread("abc" + i.toString(16).padStart(21, "0"), "Recent discussion"),
        ),
      );
      const page = await request(app).get(path).expect(200);
      expect(page.body).toHaveLength(30);
      expect(page.body.map((row: { title: string }) => row.title)).toEqual(
        Array(30).fill("Recent discussion"),
      );
      for (const q of ["#THR-ABC", "thr-abc"]) {
        const matches = await request(app).get(path).query({ q }).expect(200);
        expect(matches.body.map((row: { id: string }) => row.id).sort()).toEqual(
          [first._id.toString(), second._id.toString()],
        );
      }
      const title = await request(app)
        .get(path)
        .query({ q: "[details]" })
        .expect(200);
      expect(title.body.map((row: { id: string }) => row.id)).toEqual([
        first._id.toString(),
      ]);
    });
    it("lets a founder configure branding and control whether the portal is available", async () => {
      const settings = {
        enabled: false,
        title: "First Help",
        accent: "#147e66",
        aiEnabled: true,
        logoUrl: "https://example.test/logo.png",
      };
      await request(app)
        .patch("/threads/manage")
        .set("Authorization", agent)
        .send(settings)
        .expect(403);
      await request(app)
        .patch("/threads/manage")
        .set("Authorization", owner)
        .send(settings)
        .expect(200);
      await request(app).get(base).expect(404);
      settings.enabled = true;
      await request(app)
        .patch("/threads/manage")
        .set("Authorization", owner)
        .send(settings)
        .expect(200);
      expect((await request(app).get(base).expect(200)).body).toMatchObject({
        name: "First",
        title: settings.title,
        accent: settings.accent,
        logoUrl: settings.logoUrl,
      });
    });
    it("registers domains with real DNS instructions and resolves only active tenant hosts", async () => {
      const created = await request(app)
        .post("/threads/manage/domains")
        .set("Authorization", owner)
        .send({ hostname: "support.first.test" })
        .expect(201);
      expect(created.body).toMatchObject({
        hostname: "support.first.test",
        status: "pending_dns",
        tlsStatus: "disabled",
        dnsRecords: [
          expect.objectContaining({
            type: "TXT",
            name: "_interaone-challenge.support.first.test",
          }),
          expect.objectContaining({
            type: "CNAME",
            value: "portals.interaone.test",
          }),
        ],
      });
      await request(app)
        .get("/threads/domain-allow?domain=support.first.test")
        .expect(403);
      await request(app)
        .get("/threads/host")
        .set("Host", "support.first.test")
        .expect(404);

      await ThreadDomain.updateOne(
        { _id: created.body.id, organizationId },
        {
          $set: {
            status: "active",
            tlsStatus: "active",
            ownershipVerifiedAt: new Date(),
            routingVerifiedAt: new Date(),
            tlsVerifiedAt: new Date(),
          },
        },
      );
      expect(
        (
          await request(app)
            .get("/threads/host")
            .set("Host", "support.first.test")
            .expect(200)
        ).body,
      ).toMatchObject({ name: "First", slug: "first" });
      await request(app)
        .get("/threads/host")
        .set("Host", "support.second.test")
        .expect(404);
      await request(app)
        .get("/threads/host")
        .set("Host", "support.second.test")
        .set("X-InteraOne-Host", "support.first.test")
        .expect(404);
    });
    it("lets founders prepare ownership DNS before the deployment target is configured", async () => {
      const apiUrl = config.app.apiUrl;
      config.app.apiUrl = "http://localhost:3002";
      try {
        const created = await request(app)
          .post("/threads/manage/domains")
          .set("Authorization", owner)
          .send({ hostname: "help.first.test" })
          .expect(201);
        expect(created.body).toMatchObject({
          status: "pending_dns",
          dnsRecords: [
            expect.objectContaining({
              type: "TXT",
              name: "_interaone-challenge.help.first.test",
            }),
          ],
        });
        expect(created.body.dnsRecords).toHaveLength(1);
        expect(created.body.url).toBeUndefined();
        await request(app)
          .get("/threads/host")
          .set("Host", "help.first.test")
          .expect(404);
      } finally {
        config.app.apiUrl = apiUrl;
      }
    });
    it("enforces customer and tenant boundaries and supports public voting", async () => {
      const alice = await sign("alice@example.com"),
        bob = await sign("bob@example.com");
      const created = await request(app)
        .post(base + "/threads")
        .set("Authorization", alice)
        .send({
          title: "Private issue",
          category: "support",
          text: "Please help",
        })
        .expect(201);
      const path = base + "/threads/" + created.body.id;
      await request(app).get(path).expect(404);
      await request(app).get(path).set("Authorization", bob).expect(404);
      await request(app)
        .get(path.replace("/first/", "/second/"))
        .set("Authorization", alice)
        .expect(401);
      await request(app).get(path).set("Authorization", alice).expect(200);
      await request(app)
        .post(path + "/replies")
        .set("Authorization", alice)
        .send({ text: "Follow-up" })
        .expect(201);
      expect(
        (
          await request(app)
            .get(base + "/threads?category=support")
            .set("Authorization", alice)
            .expect(200)
        ).body,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.body.id,
            category: "support",
            public: false,
          }),
        ]),
      );
      const feature = await request(app)
        .post(base + "/threads")
        .set("Authorization", bob)
        .send({
          title: "Add themes",
          category: "feature",
          text: "Please add themes",
        })
        .expect(201);
      const shared = base + "/threads/" + feature.body.id;
      const inbox = await request(app)
        .get("/conversations?status=open&unassigned=true")
        .set("Authorization", agent)
        .expect(200);
      expect(inbox.body.data.conversations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _id: feature.body.id, channel: "threads" }),
        ]),
      );
      for (let i = 0; i < 2; i++)
        await request(app)
          .put(shared + "/vote")
          .set("Authorization", alice)
          .send({ voted: true })
          .expect(204);
      expect((await request(app).get(shared).expect(200)).body.votes).toBe(1);
      const aliceList = await request(app)
        .get(base + "/threads")
        .set("Authorization", alice)
        .expect(200);
      expect(
        aliceList.body.find(
          (thread: { id: string }) => thread.id === feature.body.id,
        ),
      ).toMatchObject({ votes: 1, voted: true });
      expect(
        (
          await request(app)
            .get(base + "/threads")
            .expect(200)
        ).body.find((thread: { id: string }) => thread.id === feature.body.id),
      ).toMatchObject({ votes: 1, voted: false });
      await request(app)
        .get(base + "/threads?engagement=upvoted")
        .expect(401);
      expect(
        (
          await request(app)
            .get(base + "/threads?engagement=upvoted")
            .set("Authorization", alice)
            .expect(200)
        ).body.map((thread: { id: string }) => thread.id),
      ).toEqual([feature.body.id]);
      await request(app)
        .put(shared + "/follow")
        .set("Authorization", alice)
        .send({ following: true })
        .expect(204);
      expect(
        (
          await request(app)
            .get(base + "/threads?engagement=following")
            .set("Authorization", alice)
            .expect(200)
        ).body.map((thread: { id: string }) => thread.id),
      ).toEqual([feature.body.id]);
      expect(
        (
          await request(app)
            .get(base + "/similar")
            .query({ title: "Add themes to the product" })
            .expect(200)
        ).body,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: feature.body.id, title: "Add themes" }),
        ]),
      );
      await request(app)
        .post(shared + "/replies")
        .set("Authorization", alice)
        .send({ text: "This would help us too" })
        .expect(201);
      const discussion = await request(app).get(shared).expect(200);
      const aliceReply = discussion.body.messages.find(
        (message: { text: string }) =>
          message.text === "This would help us too",
      );
      await request(app)
        .put(shared + "/messages/" + aliceReply.id + "/reactions")
        .set("Authorization", bob)
        .send({ emoji: "❤️", reacted: true })
        .expect(204);
      expect(
        (await request(app).get(shared).expect(200)).body.messages.find(
          (message: { id: string }) => message.id === aliceReply.id,
        ).reactions,
      ).toEqual([{ emoji: "❤️", count: 1, reacted: false }]);
      expect(
        (
          await request(app).get(shared).set("Authorization", bob).expect(200)
        ).body.messages.find(
          (message: { id: string }) => message.id === aliceReply.id,
        ).reactions,
      ).toEqual([{ emoji: "❤️", count: 1, reacted: true }]);
      await request(app)
        .post(shared + "/replies")
        .set("Authorization", bob)
        .send({ text: "Thanks for confirming", replyToId: aliceReply.id })
        .expect(201);
      expect(
        (await request(app).get(shared).expect(200)).body.messages.find(
          (message: { text: string }) =>
            message.text === "Thanks for confirming",
        ),
      ).toMatchObject({
        replyTo: {
          id: aliceReply.id,
          text: "This would help us too",
          author: "Community member",
        },
      });
      expect(
        (
          await request(app)
            .get(base + "/threads")
            .expect(200)
        ).body.map((t: { id: string }) => t.id),
      ).toEqual([feature.body.id]);
      await request(app)
        .patch("/threads/manage/" + created.body.id)
        .set("Authorization", owner)
        .send({ public: true })
        .expect(404);
      await request(app)
        .patch("/threads/manage/" + feature.body.id)
        .set("Authorization", owner)
        .send({ progress: "planned" })
        .expect(200)
        .expect(({ body }) => expect(body.progress).toBe("planned"));
      await request(app)
        .patch("/threads/manage/" + feature.body.id)
        .set("Authorization", owner)
        .send({ public: false })
        .expect(200);
      await request(app).get(shared).set("Authorization", alice).expect(404);
      await request(app).get(shared).set("Authorization", bob).expect(200);
    });
    it("preserves the support transcript through AI handoff, staff replies, notifications and resolution", async () => {
      await Contact.create({
        organizationId,
        sessionId: "existing-contact",
        email: "customer@example.com",
        name: "Existing customer",
      });
      const customer = await sign("customer@example.com");
      const {
        body: { id },
      } = await request(app)
        .post(base + "/threads")
        .set("Authorization", customer)
        .send({
          title: "Account question",
          category: "support",
          text: "Please help with setup",
        })
        .expect(201);
      const path = base + "/threads/" + id;
      expect(queue).toHaveBeenCalledWith(
        "process",
        expect.objectContaining({
          organizationId,
          channel: "threads",
          conversationId: id,
        }),
        expect.anything(),
      );
      expect(
        await Contact.countDocuments({
          organizationId,
          email: "customer@example.com",
        }),
      ).toBe(1);
      const row = await Conversation.findById(id).orFail();
      expect(row.sessionId).toBe("existing-contact");
      expect(row.metadata.escalatedAt).toBeUndefined();
      const widget = await Conversation.create({
        organizationId,
        channel: "widget",
        sessionId: "widget-inbox-regression",
      });
      const all = await request(app)
        .get("/conversations?status=open&unassigned=true")
        .set("Authorization", agent)
        .expect(200);
      const unassignedIds = all.body.data.conversations.map(
        (item: { _id: string }) => item._id,
      );
      expect(unassignedIds).toContain(id);
      expect(unassignedIds).not.toContain(widget.id);
      await Conversation.updateOne(
        { _id: widget._id, organizationId },
        { $set: { "metadata.pendingEscalation": true } },
      );
      const threadPage = await request(app)
        .get(
          "/conversations?status=open&unassigned=true&channel=threads&limit=1",
        )
        .set("Authorization", agent)
        .expect(200);
      expect(threadPage.body.data.conversations).toEqual([
        expect.objectContaining({ _id: id, channel: "threads" }),
      ]);

      const forbidden = vi.fn();
      await gatekeeperMiddleware({
        data: { user: { orgId: organizationId, isWidget: true } },
      })(["join_conversation", id], forbidden);
      expect(forbidden).toHaveBeenCalledWith(expect.any(Error));
      const memory = await request(app)
        .get("/conversations/ai/" + id + "/memory")
        .query({ organizationId })
        .set("x-ai-tool-secret", secret)
        .expect(200);
      expect(memory.body.data.memory[0]).toMatchObject({
        role: "user",
        content: "Please help with setup",
      });
      await request(app)
        .post("/conversations/ai/" + id + "/escalate")
        .set("x-ai-tool-secret", secret)
        .send({ organizationId, reason: "Needs human help" })
        .expect(200);
      expect(
        (
          await request(app)
            .get(path)
            .set("Authorization", customer)
            .expect(200)
        ).body.humanSupport,
      ).toBe(true);

      const fakeSocket = {
        data: {
          gateState: { interactionSource: "threads" },
          user: { orgId: organizationId, userId: agentId, name: "Teammate" },
        },
        handlers: new Map<string, (data: object) => Promise<void>>(),
        on(event: string, callback: (data: object) => Promise<void>) {
          this.handlers.set(event, callback);
        },
        to: () => ({ emit: vi.fn() }),
      };
      handleAgentMessage({ socket: fakeSocket, io: {} });
      await fakeSocket.handlers.get("send_message")!({
        conversationId: id,
        content: "Here are the next steps",
        type: "text",
      });
      const assigned = await request(app)
        .get("/conversations?status=open&assignedToMe=true")
        .set("Authorization", agent)
        .expect(200);
      expect(assigned.body.data.conversations).toEqual(
        expect.arrayContaining([expect.objectContaining({ _id: id })]),
      );
      const remaining = await request(app)
        .get("/conversations?status=open&unassigned=true")
        .set("Authorization", agent)
        .expect(200);
      expect(remaining.body.data.conversations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ _id: id })]),
      );
      await vi.waitFor(() =>
        expect(
          deliver.mock.calls.some(
            ([email, , html]) =>
              email === "customer@example.com" &&
              html.includes("new reply") &&
              html.includes("https://support.first.test/thread/" + id),
          ),
        ).toBe(true),
      );
      const changes = await request(app)
        .get(base + "/updates")
        .set("Authorization", customer)
        .expect(200);
      expect(changes.body.some((item: { id: string }) => item.id === id)).toBe(
        true,
      );
      const updated = await request(app)
        .get(path)
        .set("Authorization", customer)
        .expect(200);
      expect(updated.body.opening).toMatchObject({
        text: "Please help with setup",
      });
      expect(
        updated.body.messages.map((item: { text: string }) => item.text),
      ).toEqual(["Please help with setup", "Here are the next steps"]);
      await request(app)
        .patch("/conversations/" + id + "/status")
        .set("Authorization", agent)
        .send({ status: "resolved" })
        .expect(200);
      expect(
        (
          await request(app)
            .get(path)
            .set("Authorization", customer)
            .expect(200)
        ).body.status,
      ).toBe("resolved");
      await request(app)
        .post(path + "/replies")
        .set("Authorization", customer)
        .send({ text: "Still need help" })
        .expect(409);
      await request(app)
        .patch(path + "/status")
        .set("Authorization", customer)
        .send({ status: "open" })
        .expect(204);
      const prior = queue.mock.calls.length;
      await request(app)
        .post(path + "/replies")
        .set("Authorization", customer)
        .send({ text: "Still need help" })
        .expect(201);
      expect(queue.mock.calls).toHaveLength(prior);
    });
  },
);
