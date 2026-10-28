import { Worker, ConnectionOptions } from "bullmq";
import nodemailer, { Transporter } from "nodemailer";
import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";
import config, { type EmailProvider } from "../config";
import logger from "../utils/logger";

// ── Job payload ──────────────────────────────────────────────────────────────

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: {
    name: string;
    email: string;
  };
}

export const EMAIL_QUEUE = "platform-email";

// ── Adapters ─────────────────────────────────────────────────────────────────

interface EmailAdapter {
  send(options: EmailJobData): Promise<void>;
}

class MailhogEmailAdapter implements EmailAdapter {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.auth.user
        ? { user: config.email.auth.user, pass: config.email.auth.pass }
        : undefined,
      ignoreTLS: true,
    } as any);
  }

  async send(options: EmailJobData): Promise<void> {
    const fromName = options.from?.name || config.email.from.name;
    const fromEmail = options.from?.email || config.email.from.email;

    await this.transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}

class SmtpEmailAdapter implements EmailAdapter {
  private transporter: Transporter;

  constructor() {
    const { host, port, secure, requireTls, auth } = config.email.smtp;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: requireTls,
      auth: auth.user ? { user: auth.user, pass: auth.pass } : undefined,
    });
  }

  async send(options: EmailJobData): Promise<void> {
    const fromName = options.from?.name || config.email.from.name;
    const fromEmail = options.from?.email || config.email.from.email;

    const info = await this.transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    const accepted: string[] = Array.isArray(info.accepted)
      ? info.accepted.map(String)
      : [];
    const rejected: string[] = Array.isArray(info.rejected)
      ? info.rejected.map(String)
      : [];
    const pending: string[] = Array.isArray(info.pending)
      ? info.pending.map(String)
      : [];
    const intendedRecipient = options.to.trim().toLowerCase();
    const intendedRecipientAccepted = accepted.some(
      (recipient) => recipient.trim().toLowerCase() === intendedRecipient,
    );

    logger.info("SMTP delivery result", {
      messageId: info.messageId,
      accepted,
      rejected,
      pending,
      response: info.response,
      intendedRecipientAccepted,
    });

    if (!intendedRecipientAccepted) {
      throw new Error("SMTP server did not accept the intended recipient");
    }
  }
}

class SesEmailAdapter implements EmailAdapter {
  private client: SESClient;

  constructor() {
    const { accessKeyId, secretAccessKey, region } = config.email.aws;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for SES provider");
    }
    this.client = new SESClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async send(options: EmailJobData): Promise<void> {
    const fromName = options.from?.name || config.email.from.name;
    const fromEmail = options.from?.email || config.email.from.email;

    await this.client.send(
      new SendEmailCommand({
        Source: `"${fromName}" <${fromEmail}>`,
        Destination: { ToAddresses: [options.to] },
        Message: {
          Subject: { Data: options.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: options.html, Charset: "UTF-8" },
            ...(options.text
              ? { Text: { Data: options.text, Charset: "UTF-8" } }
              : {}),
          },
        },
      }),
    );
  }
}

class DisabledEmailAdapter implements EmailAdapter {
  async send(options: EmailJobData): Promise<void> {
    logger.warn("Email skipped because provider is disabled", {
      to: options.to,
    });
  }
}

function buildAdapter(provider: EmailProvider): EmailAdapter {
  const providers: Record<EmailProvider, () => EmailAdapter> = {
    mailhog: () => new MailhogEmailAdapter(),
    smtp: () => new SmtpEmailAdapter(),
    ses: () => new SesEmailAdapter(),
    disabled: () => new DisabledEmailAdapter(),
  };

  const factory = providers[provider];
  if (!factory) {
    return new DisabledEmailAdapter();
  }

  return factory();
}

// ── Worker ───────────────────────────────────────────────────────────────────

export function startEmailWorker() {
  const adapter = buildAdapter(config.email.provider);

  const connection: ConnectionOptions = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
  };

  const worker = new Worker<EmailJobData, void, string>(
    EMAIL_QUEUE,
    async (job) => {
      logger.info("Sending email job", {
        jobId: job.id,
        jobName: job.name,
        queue: EMAIL_QUEUE,
        to: job.data.to,
        provider: config.email.provider,
        attempt: job.attemptsMade + 1,
      });

      await adapter.send(job.data);
    },
    { connection, concurrency: config.worker.concurrency },
  );

  worker.on("completed", (job) =>
    logger.info("Email job completed", {
      jobId: job.id,
      queue: EMAIL_QUEUE,
      to: job.data.to,
      attemptsMade: job.attemptsMade,
    }),
  );
  worker.on("failed", (job, err) =>
    logger.error("Email job failed", {
      jobId: job?.id,
      queue: EMAIL_QUEUE,
      to: job?.data.to,
      attemptsMade: job?.attemptsMade,
      error: err,
    }),
  );
  worker.on("error", (err) =>
    logger.error("Email worker error", { queue: EMAIL_QUEUE, error: err }),
  );

  logger.info("Email worker started", {
    queue: EMAIL_QUEUE,
    provider: config.email.provider,
    concurrency: config.worker.concurrency,
  });

  return worker;
}
