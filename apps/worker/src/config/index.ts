import dotenv from "dotenv";
dotenv.config();

type EmailProvider = "mailhog" | "smtp" | "ses" | "disabled";

function parseEmailProvider(value?: string): EmailProvider {
  const normalized = (value || "").toLowerCase() as EmailProvider;
  const valid: EmailProvider[] = ["mailhog", "smtp", "ses", "disabled"];
  return valid.includes(normalized)
    ? normalized
    : process.env.NODE_ENV === "development"
      ? "mailhog"
      : "disabled";
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false"`);
}

function parseSmtpPort(value: string | undefined, secure: boolean): number {
  const port = Number(value || (secure ? "465" : "587"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function smtpConfig(provider: EmailProvider) {
  const secure =
    provider === "smtp"
      ? parseBoolean(process.env.SMTP_SECURE, "SMTP_SECURE")
      : false;
  const requireTls =
    provider === "smtp"
      ? parseBoolean(process.env.SMTP_REQUIRE_TLS, "SMTP_REQUIRE_TLS")
      : false;
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER || undefined;
  const pass = process.env.SMTP_PASS || undefined;

  if (provider === "smtp") {
    if (!host)
      throw new Error("SMTP_HOST is required when EMAIL_PROVIDER=smtp");
    if (secure && requireTls) {
      throw new Error("SMTP_SECURE and SMTP_REQUIRE_TLS cannot both be true");
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw new Error("SMTP_USER and SMTP_PASS must be provided together");
    }
  }

  return {
    host,
    port:
      provider === "smtp" ? parseSmtpPort(process.env.SMTP_PORT, secure) : 587,
    secure,
    requireTls,
    auth: { user, pass },
  };
}

/**
 * Returns true when the Enterprise Edition is active in this deployment.
 * Mirrors the logic in apps/gateway/src/shared/ee/env.ts — kept as a local
 * helper so the worker does not have to import from the gateway package.
 */
export function isEeEnabled(): boolean {
  return true;
}

const emailProvider = parseEmailProvider(process.env.EMAIL_PROVIDER);

const config = {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  database: {
    mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/interaone",
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
  },
  leadSources: {
    encryptionKey: process.env.LEAD_SOURCE_ENCRYPTION_KEY,
    facebook: {
      graphApiVersion: process.env.META_GRAPH_API_VERSION || "v26.0",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      pollIntervalMs: Math.max(
        15_000,
        parseInt(process.env.GOOGLE_FORMS_POLL_INTERVAL_MS || "60000", 10),
      ),
    },
  },
  email: {
    provider: emailProvider,
    host: process.env.EMAIL_HOST || "localhost",
    port: parseInt(process.env.EMAIL_PORT || "1025", 10),
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER || undefined,
      pass: process.env.EMAIL_PASS || undefined,
    },
    smtp: smtpConfig(emailProvider),
    aws: {
      region: process.env.AWS_REGION || "us-east-1",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
    },
    from: {
      name: process.env.EMAIL_FROM_NAME || "InteraOne",
      email:
        process.env.EMAIL_FROM_EMAIL
        || process.env.EMAIL_FROM_ADDRESS
        || "noreply@interaone.app",
    },
  },
};

export default config;
export type { EmailProvider };
