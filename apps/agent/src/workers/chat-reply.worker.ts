import { Worker } from "bullmq";
import config from "../config";
import { runPipeline } from "../modules/chat/pipelines/run-pipeline";
import { AIJobData } from "../modules/chat/chat.types";
import { getBullMQConnection } from "../infrastructure/queue/bullmq.client";
import logger from "../shared/logger";
import { InternalApiService } from "../infrastructure/api/internal-api.service";

const QUEUE_NAME = "ai-processing";

export function startChatReplyWorker() {
  const connection = getBullMQConnection();

  const worker = new Worker<AIJobData, void, string>(
    QUEUE_NAME,
    async (job) => {
      logger.info("AI job started", {
        jobId: job.id,
        queue: QUEUE_NAME,
        conversationId: job.data.conversationId,
        organizationId: job.data.organizationId,
        messageId: job.data.messageId,
        attempt: job.attemptsMade + 1,
      });

      try {
        await runPipeline(job.data);
      } catch (error) {
        if (job.data.channel === "threads") {
          await InternalApiService.escalateConversation(job.data.conversationId, {
            organizationId: job.data.organizationId,
            reason: "AI support failed",
          }).catch((handoffError) => logger.error("Threads handoff failed", { handoffError, jobId: job.id }));
        }
        throw error;
      }
    },
    { connection, concurrency: config.worker.concurrency },
  );

  worker.on("completed", (job) =>
    logger.info("AI job completed", {
      jobId: job.id,
      queue: QUEUE_NAME,
      conversationId: job.data.conversationId,
      organizationId: job.data.organizationId,
      attemptsMade: job.attemptsMade,
    }),
  );
  worker.on("failed", (job, err) =>
    logger.error("AI job failed", {
      jobId: job?.id,
      queue: QUEUE_NAME,
      conversationId: job?.data.conversationId,
      organizationId: job?.data.organizationId,
      messageId: job?.data.messageId,
      attemptsMade: job?.attemptsMade,
      error: err,
    }),
  );
  worker.on("error", (err) =>
    logger.error("AI worker error", { queue: QUEUE_NAME, error: err }),
  );

  logger.info("AI worker started", {
    queue: QUEUE_NAME,
    concurrency: config.worker.concurrency,
  });

  return worker;
}
