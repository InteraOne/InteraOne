import logger from "@shared/core/logger";
import {
  enqueueAgentVerificationOTPEmail,
  enqueueConversationSummaryEmail,
} from "@shared/queues/email.queue";
import { Conversation } from "@shared/models";
import { generateOTP, hashOTP, verifyOTP } from "@shared/security/auth/otp";
import {
  SendEmailInput,
  SendEmailResult,
  VerifyAgentOtpInput,
  VerifyAgentOtpResult,
} from "./email.types";

const AGENT_OTP_EXPIRY_MS = 10 * 60 * 1000;
const AGENT_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const AGENT_OTP_MAX_ATTEMPTS = 5;

export class EmailService {
  /**
   * Send an email by queuing it on the platform email queue.
   * Strictly limited to AI-authorized templates: 'agent_verification_otp' and 'conversation_summary'.
   */
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      let queued = false;

      if (input.template === "agent_verification_otp") {
        if (!input.organizationId || !input.conversationId) {
          return {
            success: false,
            error: "organizationId and conversationId are required for identity verification",
          };
        }

        const email = input.to.trim().toLowerCase();
        const conversation = await Conversation.findOne({
          _id: input.conversationId,
          organizationId: input.organizationId,
        })
          .select("metadata.identityVerification")
          .lean();

        if (!conversation) {
          return { success: false, error: "Conversation not found" };
        }

        const existingChallenge = conversation.metadata?.identityVerification;
        const lastSentAt = existingChallenge?.lastSentAt
          ? new Date(existingChallenge.lastSentAt).getTime()
          : 0;
        if (lastSentAt && Date.now() - lastSentAt < AGENT_OTP_RESEND_COOLDOWN_MS) {
          return { success: false, error: "Please wait before requesting another OTP" };
        }

        const otp = generateOTP();
        const codeHash = await hashOTP(otp);
        const expiresAt = new Date(Date.now() + AGENT_OTP_EXPIRY_MS);

        queued = await enqueueAgentVerificationOTPEmail(email, otp);
        if (queued) {
          await Conversation.updateOne(
            { _id: input.conversationId, organizationId: input.organizationId },
            {
              $set: {
                "metadata.identityVerification": {
                  email,
                  codeHash,
                  expiresAt,
                  attempts: 0,
                  lastSentAt: new Date(),
                  verifiedAt: null,
                },
              },
            },
          );
        }
      } else if (input.template === "conversation_summary") {
        const { name, companyName, summary } = input.variables || {};
        if (!name || !companyName || !summary) {
          return {
            success: false,
            error: "Variables 'name', 'companyName', and 'summary' are required for 'conversation_summary' template",
          };
        }
        queued = await enqueueConversationSummaryEmail(input.to, name, companyName, summary);
      } else {
        return {
          success: false,
          error: `Template '${input.template}' is restricted or unsupported by AI`,
        };
      }

      if (!queued) {
        logger.warn(`[EmailService] Platform template email '${input.template}' is disabled or failed to queue`);
        return { success: false, error: "Email provider not configured or disabled" };
      }

      logger.info(`[EmailService] Platform template email '${input.template}' successfully queued`, {
        to: input.to,
      });

      return { success: true, messageId: "queued" };
    } catch (err: any) {
      logger.error("[EmailService] Failed to queue email", { error: err?.message || err });
      return { success: false, error: err?.message || "Failed to queue email" };
    }
  }

  async verifyAgentOtp(input: VerifyAgentOtpInput): Promise<VerifyAgentOtpResult> {
    try {
      const email = input.email?.trim().toLowerCase();
      const conversation = await Conversation.findOne({
        _id: input.conversationId,
        organizationId: input.organizationId,
      })
        .select("metadata.identityVerification")
        .lean();

      const challenge = conversation?.metadata?.identityVerification;
      if (!challenge || !challenge.codeHash || (email && challenge.email !== email)) {
        return { success: false, statusCode: 400, error: "No active verification code found" };
      }

      if (new Date(challenge.expiresAt).getTime() < Date.now()) {
        return { success: false, statusCode: 400, error: "OTP has expired. Please request a new code." };
      }

      const attempts = Number(challenge.attempts || 0);
      if (attempts >= AGENT_OTP_MAX_ATTEMPTS) {
        return { success: false, statusCode: 429, error: "Too many attempts. Please request a new OTP." };
      }

      const valid = await verifyOTP(input.code, challenge.codeHash);
      if (!valid) {
        await Conversation.updateOne(
          { _id: input.conversationId, organizationId: input.organizationId },
          { $inc: { "metadata.identityVerification.attempts": 1 } },
        );
        return { success: false, statusCode: 400, error: "Invalid OTP" };
      }

      const verifiedAt = new Date();
      const verified = await Conversation.updateOne(
        {
          _id: input.conversationId,
          organizationId: input.organizationId,
          "metadata.identityVerification.email": challenge.email,
          "metadata.identityVerification.codeHash": challenge.codeHash,
        },
        {
          $set: {
            "metadata.identityVerification.verifiedAt": verifiedAt,
            "metadata.identityVerification.attempts": attempts,
          },
          $unset: { "metadata.identityVerification.codeHash": 1 },
        },
      );
      if (!verified.modifiedCount) return { success: false, statusCode: 400, error: "Verification challenge changed or was already used" };

      return { success: true, email: challenge.email, verifiedAt: verifiedAt.toISOString() };
    } catch (err: any) {
      logger.error("[EmailService] Failed to verify agent OTP", { error: err?.message || err });
      return { success: false, statusCode: 500, error: err?.message || "Failed to verify OTP" };
    }
  }
}
