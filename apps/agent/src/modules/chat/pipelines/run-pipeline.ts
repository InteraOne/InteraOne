import { buildContext } from "./context-builder.service";
import {
  ProviderFactory,
  FallbackRouter,
} from "../../../infrastructure/providers";
import { LLMMessage } from "../../../infrastructure/providers/types/ai.types";
import { publishResponse } from "../../../infrastructure/queue/reply.queue";
import { AIJobData } from "../chat.types";
import { getToolsForContext } from "../../agents/tools";
import {
  publishStreamWithSeq,
  waitForPendingStream,
} from "../services/stream.service";
import { InternalApiService } from "../../../infrastructure/api/internal-api.service";
import { redactOtpForLog } from "../utils/chat.utils";
import { makeTimer } from "../../../shared/timing";
import { executePreChecks } from "./gates.middleware";

export async function runPipeline(job: AIJobData): Promise<void> {
  const { conversationId, content } = job;

  // Short suffix used as a unique label for console.time so concurrent jobs don't collide
  const { cid, t } = makeTimer(conversationId);

  // ── TOTAL pipeline timer ──────────────────────────────────────────────────
  console.time(t("total"));

  const startTime = Date.now();
  const steps: any[] = [];
  let status: "success" | "failed" = "success";
  let error: string | undefined;
  let usage: any;

  // ── PRE-CHECK MIDDLEWARE ──────────────────────────────────────────────────
  // Runs gate checks, subscription validation, OTP verification, and FAQ fast-path.
  // Returns early if the job should be terminated without entering the LLM loop.
  const preCheck = await executePreChecks({
    job,
    conversationId,
    content,
    startTime,
    steps,
    cid,
    t,
  });

  if (preCheck.shouldReturn) {
    return;
  }

  const { channel, verifiedIdentityEmail, otpCode } = preCheck;

  console.log(
    `[Pipeline] content: ${redactOtpForLog(content).slice(0, 120).replace(/\n/g, " ")}`,
  );

  try {
    // -- 1. Context -------------------------------------------------------------
    console.time(t("agent"));
    console.time(t("context:build"));
    const context = await buildContext(
      conversationId,
      job.organizationId,
      content,
      job.messageId,
      job.companyName,
      job.fallbackToAgent,
      job.collectUserInfo,
      channel,
    );
    console.timeEnd(t("context:build"));

    if (verifiedIdentityEmail) {
      const verifiedCodePattern = new RegExp(`\\b${otpCode}\\b`, "g");
      context.messages = context.messages.map((message) => ({
        ...message,
        content: message.content.replace(
          verifiedCodePattern,
          "[verified code omitted]",
        ),
      }));
      context.systemPrompt += `

    <runtime_identity_verification>
      The visitor successfully verified the one-time email code in this turn for ${verifiedIdentityEmail}.
      Inform them briefly that verification succeeded, then continue the pending account-related request using available tools.
      Do NOT request or verify another code for this email unless the visitor changes account identity or explicitly requests a new verification.
    </runtime_identity_verification>`;
    }

    console.log(`[Pipeline] turnCount      : ${context.turnCount}`);

    // -- 2. Build message thread for LLM ----------------------------------------
    const messages: LLMMessage[] = [
      { role: "system", content: context.systemPrompt },
      ...context.messages.map((m) => ({
        role: m.role as LLMMessage["role"],
        content: m.content,
      })),
    ];

    // -- 3. Generate response ----------------------------------------------------
    let generatedText: string;
    const pendingStreamPublishes: Promise<void>[] = [];
    try {
      // Capabilities are resolved from the registry — no string matching
      const provider = ProviderFactory.getLLMProvider();
      const capabilities = await provider.getCapabilities();
      const tools = capabilities.supportsTools
        ? await getToolsForContext({
            fallbackToAgent: job.fallbackToAgent,
            channel,
            organizationId: job.organizationId,
            conversationId: job.conversationId,
          })
        : [];

      console.time(t("llm"));
      const llmStart = performance.now();
      let hasReceivedFirstToken = false;

      // FallbackRouter wraps generation with an ordered provider fallback chain
      const generated = await FallbackRouter.generate(messages, {
        tools,
        toolContext: {
          organizationId: job.organizationId,
          conversationId: job.conversationId,
          messageId: job.messageId,
        },
        onStream: capabilities.supportsStreaming
          ? (chunk, isThought = false) => {
              if (!hasReceivedFirstToken) {
                hasReceivedFirstToken = true;
                const ttftPipeline = Date.now() - startTime;
                const ttftLlm = performance.now() - llmStart;
                console.log(
                  `[${cid}] ttft: ${ttftPipeline.toFixed(2)}ms (from request) | llm_ttft: ${ttftLlm.toFixed(2)}ms (from LLM start) (isThought=${isThought})`,
                );
              }
              const publish = publishStreamWithSeq({
                conversationId,
                messageId: job.messageId,
                chunk,
                isThought,
              }).catch((err) =>
                console.error("[Pipeline] Stream publish failed:", err.message),
              );
              pendingStreamPublishes.push(publish);
            }
          : undefined,
        onToolEvent: (event) => {
          const publish = publishStreamWithSeq({
            conversationId,
            messageId: job.messageId,
            chunk: "",
            isThought: false,
            toolEvent: event,
          }).catch((err) =>
            console.error("[Pipeline] Tool event publish failed:", err.message),
          );
          pendingStreamPublishes.push(publish);
        },
      });
      await Promise.all(pendingStreamPublishes);
      console.timeEnd(t("llm"));
      console.timeEnd(t("agent"));

      generatedText = generated.text;
      usage = generated.usage;
      if (generated.steps) {
        steps.push(...generated.steps);
      }
    } catch (providerErr) {
      console.error("[Pipeline] LLM provider threw an error:", providerErr);
      await Promise.all(pendingStreamPublishes);
      const canEscalate = job.fallbackToAgent !== false;
      const fallback =
        "I'm sorry - I'm having trouble connecting right now. Please try again in a moment." +
        (canEscalate
          ? " If you need immediate help, I can connect you to a human agent."
          : "");
      await waitForPendingStream(conversationId, job.messageId);
      await publishResponse({
        conversationId,
        messageId: job.messageId,
        content: fallback,
      });

      if (canEscalate) {
        try {
          await InternalApiService.escalateConversation(conversationId, {
            organizationId: job.organizationId,
            reason: "LLM provider error — auto-escalated to human",
          });
        } catch (escErr: any) {
          console.error(
            "[Pipeline] Failed to escalate conversation on provider error:",
            escErr.message,
          );
        }
      }

      try {
        console.timeEnd(t("llm"));
      } catch {}
      try {
        console.timeEnd(t("agent"));
      } catch {}
      status = "failed";
      error =
        providerErr instanceof Error
          ? providerErr.message
          : String(providerErr);
      console.timeEnd(t("total"));
      return;
    }

    console.log(
      `[Pipeline] raw LLM response: ${generatedText.slice(0, 200).replace(/\n/g, " ")}`,
    );

    // -- 4. Publish regular response ---------------------------------------------
    console.time(t("publish:response"));
    await waitForPendingStream(conversationId, job.messageId);
    await publishResponse({
      conversationId,
      messageId: job.messageId,
      content: generatedText,
      usage,
    });
    console.timeEnd(t("publish:response"));
  } catch (err: any) {
    status = "failed";
    error = err.message || String(err);
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    console.timeEnd(t("total"));
    try {
      await InternalApiService.saveAgentRunLogs(conversationId, {
        organizationId: job.organizationId,
        messageId: job.messageId,
        steps,
        duration,
        status,
        error,
        usage,
      });
    } catch (apiErr: any) {
      console.error(
        "[Pipeline] Failed to save agent run logs:",
        apiErr.message,
      );
    }
  }
}
