import { getConversationGate } from "../../../infrastructure/cache";
import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import { getTool } from "../../agents/tools";
import { publishResponse } from "../../../infrastructure/queue/reply.queue";
import { ProviderFactory } from "../../../infrastructure/providers";
import { vectorStore } from "../../../infrastructure/vector";
import {
  exactOtpCode,
  isLikelyQuestion,
  shouldSkipConversation,
} from "../utils/chat.utils";
import { makeTimer } from "../../../shared/timing";
import { Channel, MiddlewareContext, MiddlewareResult } from "../chat.types";
import { isDirectToolExecutionRequest } from "../../agents/tools/connected-tool-routing";
import { shouldGroundKnowledgeRequest } from "./knowledge-grounding";

// Re-export makeTimer so callers can construct a MiddlewareContext conveniently
export { makeTimer };

// ── Gate 1: Conversation status ──────────────────────────────────────────────

/**
 * Skip processing if the conversation is already escalated, closed, or
 * assigned to a human agent.
 */
async function checkConversationGate(
  ctx: MiddlewareContext,
): Promise<{ shouldReturn: boolean; channel: Channel }> {
  const { job, conversationId, t } = ctx;

  console.time(t("gate:cache"));
  const gate = await getConversationGate(conversationId, job.organizationId);
  console.timeEnd(t("gate:cache"));

  if (shouldSkipConversation(gate)) {
    console.log(
      `[Pipeline] Skipping job - conversation ${conversationId} already escalated/closed/assigned`,
    );
    console.timeEnd(t("total"));
    return { shouldReturn: true, channel: "widget" };
  }

  const channel = (gate?.interactionSource ||
    job.channel ||
    "widget") as Channel;

  console.log(
    `\n[Pipeline] --- NEW JOB ----------------------------------------`,
  );
  console.log(`[Pipeline] conversationId : ${conversationId}`);
  console.log(`[Pipeline] messageId      : ${job.messageId}`);
  console.log(`[Pipeline] organizationId : ${job.organizationId}`);
  console.log(`[Pipeline] channel        : ${channel}`);
  console.log(`[Pipeline] fallbackToAgent: ${job.fallbackToAgent ?? true}`);
  console.log(
    `[Pipeline] collectUserInfo: ${JSON.stringify(job.collectUserInfo ?? {})}`,
  );

  return { shouldReturn: false, channel };
}

// ── Gate 2: AI availability / subscription ───────────────────────────────────

/**
 * Block processing if AI is disabled or the subscription has expired.
 * If escalation is enabled, auto-escalates the conversation to a human agent.
 */
async function checkSubscription(
  ctx: MiddlewareContext,
): Promise<{ shouldReturn: boolean }> {
  const { job, conversationId, t } = ctx;

  const isAiEnabled = job.aiEnabled !== false;
  const isSubActive = job.subscriptionExpired !== true;
  const canEscalate = job.fallbackToAgent !== false;

  if (isAiEnabled && isSubActive) {
    return { shouldReturn: false };
  }

  console.log(
    `[Pipeline] AI is disabled/expired (aiEnabled: ${isAiEnabled}, subActive: ${isSubActive}).`,
  );

  if (canEscalate) {
    console.log(`[Pipeline] Escalating conversation ${conversationId}`);
    try {
      await InternalApiService.escalateConversation(conversationId, {
        organizationId: job.organizationId,
        reason: !isSubActive
          ? "Subscription expired — auto-escalated to human"
          : "AI disabled — auto-escalated to human",
        unassigned: true,
      });
    } catch (escErr: any) {
      console.error(
        "[Pipeline] Failed to escalate conversation on AI disabled/expired:",
        escErr.message,
      );
    }
  } else {
    console.log(
      `[Pipeline] Escalation is disabled — dropping conversation without response/escalation.`,
    );
  }

  console.timeEnd(t("total"));
  return { shouldReturn: true };
}

// ── Gate 3: OTP verification ─────────────────────────────────────────────────

/**
 * If the message is a 6-digit OTP code, verify it. On success the caller
 * receives the verified email address to inject into the system prompt.
 * On failure a user-friendly reply is published and processing halts.
 */
async function checkOtpVerification(ctx: MiddlewareContext): Promise<{
  shouldReturn: boolean;
  verifiedIdentityEmail: string | null;
  otpCode: string | null;
}> {
  const { job, conversationId, content, startTime, steps, t } = ctx;

  const otpCode = exactOtpCode(content);
  if (!otpCode) {
    return { shouldReturn: false, verifiedIdentityEmail: null, otpCode: null };
  }

  console.time(t("otp:verify"));
  const verifyTool = getTool("verify_email_otp");
  const stepTimestamp = new Date();
  const verification = verifyTool
    ? ((await verifyTool.execute(
        { code: otpCode },
        {
          organizationId: job.organizationId,
          conversationId: job.conversationId,
          messageId: job.messageId,
        },
      )) as {
        status?: string;
        verified?: boolean;
        email?: string | null;
        message?: string;
      })
    : {
        status: "error",
        verified: false,
        message: "OTP verifier is unavailable",
      };
  console.timeEnd(t("otp:verify"));

  steps.push({
    toolName: "verify_email_otp",
    args: { code: otpCode },
    result: verification,
    error: verification.status === "error" ? verification.message : undefined,
    timestamp: stepTimestamp,
  });

  if (verification.verified === true) {
    return {
      shouldReturn: false,
      verifiedIdentityEmail: verification.email || null,
      otpCode,
    };
  }

  // Verification failed — only respond if a code was actually active
  if (verification.message === "No active verification code found") {
    return { shouldReturn: false, verifiedIdentityEmail: null, otpCode };
  }

  let reply =
    "That verification code did not match. Please check the latest code in your email and try again.";
  if (verification.message?.includes("expired")) {
    reply =
      "That verification code has expired. Please request a new code and try again.";
  } else if (verification.message?.includes("Too many attempts")) {
    reply =
      "Too many verification attempts were made. Please request a new code and try again.";
  } else if (verification.message && verification.message !== "Invalid OTP") {
    reply =
      "I could not verify that code right now. Please try again in a moment.";
  }

  await publishResponse({
    conversationId,
    messageId: job.messageId,
    content: reply,
  });

  try {
    await InternalApiService.saveAgentRunLogs(conversationId, {
      organizationId: job.organizationId,
      messageId: job.messageId,
      steps,
      duration: Date.now() - startTime,
      status: "success",
    });
  } catch (apiErr: any) {
    console.error("[Pipeline] Failed to save agent run logs:", apiErr.message);
  }

  console.timeEnd(t("total"));
  return { shouldReturn: true, verifiedIdentityEmail: null, otpCode };
}

// ── Gate 4: FAQ fast-path ────────────────────────────────────────────────────

/**
 * For question-like messages, perform a semantic search against the FAQ
 * collection. If a match scores ≥ 0.85, publish the canned answer directly
 * and skip the LLM generation entirely.
 */
async function checkFaqFastPath(
  ctx: MiddlewareContext,
  otpCode: string | null,
): Promise<{ shouldReturn: boolean }> {
  const { job, conversationId, content, startTime, steps, t } = ctx;

  if (otpCode) {
    return { shouldReturn: false };
  }

  // Execution commands must reach dynamic connected-tool discovery. A semantic
  // FAQ hit is documentation, not evidence that an external action ran.
  if (isDirectToolExecutionRequest(content)) {
    console.log(
      "[Pipeline] Skipping FAQ check for direct tool execution intent",
    );
    return { shouldReturn: false };
  }

  // Grounded factual requests are searched once in the main pipeline. Running
  // the FAQ search here would repeat the same remote embedding call.
  if (shouldGroundKnowledgeRequest(content)) {
    console.log("[Pipeline] Skipping FAQ check for grounded factual request");
    return { shouldReturn: false };
  }

  if (!isLikelyQuestion(content)) {
    console.log(
      `[Pipeline] Skipping FAQ check (not a question): "${content.slice(0, 50)}"`,
    );
    return { shouldReturn: false };
  }

  try {
    const embeddingProvider = ProviderFactory.getEmbeddingProvider();

    console.time(t("embed:faq"));
    const queryVector = await embeddingProvider.embed(content.trim(), {
      organizationId: job.organizationId,
      conversationId,
    });
    console.timeEnd(t("embed:faq"));

    console.time(t("qdrant:faq"));
    const results = await vectorStore.search(queryVector, {
      organizationId: job.organizationId,
      topK: 1,
      type: "faq",
    });
    console.timeEnd(t("qdrant:faq"));

    if (results.length === 0) return { shouldReturn: false };

    const match = results[0];
    if (match.score < 0.85) return { shouldReturn: false };

    const faqAnswer =
      (match.payload as any)?.answer || (match.payload as any)?.content || "";

    if (!faqAnswer) return { shouldReturn: false };

    console.log(
      `[Pipeline] FAQ match (score: ${match.score.toFixed(4)}) - returning directly, no LLM`,
    );

    await publishResponse({
      conversationId,
      messageId: job.messageId,
      content: faqAnswer,
    });

    steps.push({
      toolName: "faq_fast_path",
      args: { query: content },
      result: {
        score: match.score,
        question: (match.payload as any)?.question,
        answer: faqAnswer,
      },
      timestamp: new Date(),
    });

    try {
      await InternalApiService.saveAgentRunLogs(conversationId, {
        organizationId: job.organizationId,
        messageId: job.messageId,
        steps,
        duration: Date.now() - startTime,
        status: "success",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
    } catch (apiErr: any) {
      console.error(
        "[Pipeline] Failed to save agent run logs:",
        apiErr.message,
      );
    }

    console.timeEnd(t("total"));
    return { shouldReturn: true };
  } catch (faqErr: any) {
    console.error("[Pipeline] FAQ check failed:", faqErr.message);
    return { shouldReturn: false };
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run all pre-generation gates in order. Returns `shouldReturn: true` as soon
 * as any gate handles the job (early exit). Otherwise returns the resolved
 * channel and identity state for the LLM generation phase.
 */
export async function executePreChecks(
  ctx: MiddlewareContext,
): Promise<MiddlewareResult> {
  // Gate 1 — conversation status
  const gateCheck = await checkConversationGate(ctx);
  if (gateCheck.shouldReturn) return { shouldReturn: true };

  // Gate 2 — subscription / AI availability
  const subCheck = await checkSubscription(ctx);
  if (subCheck.shouldReturn) return { shouldReturn: true };

  // Gate 3 — OTP verification
  const otpCheck = await checkOtpVerification(ctx);
  if (otpCheck.shouldReturn) return { shouldReturn: true };

  // Gate 4 — FAQ fast-path (skipped when message was an OTP code)
  const faqCheck = await checkFaqFastPath(ctx, otpCheck.otpCode);
  if (faqCheck.shouldReturn) return { shouldReturn: true };

  return {
    shouldReturn: false,
    channel: gateCheck.channel,
    verifiedIdentityEmail: otpCheck.verifiedIdentityEmail,
    otpCode: otpCheck.otpCode,
  };
}
