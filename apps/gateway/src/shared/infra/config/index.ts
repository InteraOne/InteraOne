import dotenv from "dotenv";

dotenv.config();

interface Config {
  app: {
    port: number;
    env: string;
    clientUrl: string;
    mode: "cloud" | "self-host";
    apiUrl: string;
    allowedDomains: string[];
  };
  database: {
    mongoUri: string;
  };
  redis: {
    redisUri?: string;
    host: string;
    port: number;
    password?: string;
  };
  jwt: {
    secret: string;
    expiresIn: string | number;
    refreshSecret: string;
    refreshExpiresIn: string | number;
  };
  email: {
    provider: "mailhog" | "smtp" | "ses" | "resend" | "disabled";
    from: {
      name: string;
      email: string;
    };
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  cors: {
    allowedOrigins: string[];
  };
  silo: {
    bucketName: string;
    silo_uri: string;
    silo_public_url: string;
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey?: string;
    secretKey?: string;
    publicUrl: string;
  };
  aws: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  leadSources: {
    encryptionKey?: string;
    facebook: {
      appId?: string;
      appSecret?: string;
      verifyToken?: string;
      redirectUri?: string;
      graphApiVersion: string;
      oauthScopes: string[];
    };
    google: {
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      oauthScopes: string[];
    };
    googleCalendar: {
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      oauthScopes: string[];
    };
    googleTasks: {
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      oauthScopes: string[];
    };
  };
}

function parseEmailProvider(value?: string): Config["email"]["provider"] {
  const normalized = (value || "").toLowerCase();
  if (
    normalized === "mailhog" ||
    normalized === "smtp" ||
    normalized === "ses" ||
    normalized === "resend" ||
    normalized === "disabled"
  ) {
    return normalized;
  }
  return process.env.NODE_ENV === "development" ? "mailhog" : "disabled";
}

function parseRedisConfig(): Config["redis"] {
  const redisUri = process.env.REDIS_URI;
  if (redisUri) {
    const url = new URL(redisUri);
    return {
      redisUri,
      host: url.hostname,
      port: url.port ? parseInt(url.port, 10) : 6379,
      password: url.password || undefined,
    };
  }

  return {
    redisUri,
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD,
  };
}

function parseSiloConfig(): Config["silo"] {
  const siloUri = process.env.SILO_URI;
  const siloPublicUrl = process.env.SILO_PUBLIC_URL || "";

  if (siloUri) {
    const url = new URL(siloUri);
    const useSSL = url.protocol === "https:";
    const port = url.port ? parseInt(url.port, 10) : useSSL ? 443 : 80;

    return {
      bucketName: process.env.SILO_BUCKET_NAME!,
      silo_uri: siloUri,
      silo_public_url: siloPublicUrl,
      endpoint: url.hostname,
      port,
      useSSL,
      accessKey: url.username || process.env.SILO_ACCESS_KEY,
      secretKey: url.password || process.env.SILO_SECRET_KEY,
      publicUrl: siloPublicUrl,
    };
  }

  return {
    bucketName: process.env.SILO_BUCKET_NAME!,
    silo_uri: siloUri || "",
    silo_public_url: siloPublicUrl,
    endpoint: process.env.SILO_ENDPOINT!,
    port: parseInt(process.env.SILO_PORT || "9000", 10),
    useSSL: process.env.SILO_USE_SSL === "true",
    accessKey: process.env.SILO_ACCESS_KEY,
    secretKey: process.env.SILO_SECRET_KEY,
    publicUrl: siloPublicUrl,
  };
}

const config: Config = {
  app: {
    port: 3002,
    env: process.env.NODE_ENV || "development",
    clientUrl:
      process.env.CLIENT_URL ||
      (process.env.NODE_ENV === "production"
        ? (() => {
            throw new Error(
              "CLIENT_URL environment variable is required in production",
            );
          })()
        : "http://localhost:5173"),
    mode:
      (process.env.INTERAONE_MODE || "self-host") === "cloud"
        ? "cloud"
        : "self-host",
    apiUrl: process.env.PUBLIC_API_URL || "http://localhost:3002",
    allowedDomains: (
      process.env.ALLOWED_DOMAINS ||
      process.env.ALLOWED_DOMAIN ||
      ""
    )
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  },
  database: {
    mongoUri: process.env.MONGODB_URI!,
  },
  redis: parseRedisConfig(),
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN!,
  },
  email: {
    provider: parseEmailProvider(process.env.EMAIL_PROVIDER),
    from: {
      name: process.env.EMAIL_FROM_NAME!,
      email: process.env.EMAIL_FROM_EMAIL!,
    },
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "10000", 10),
  },
  cors: {
    allowedOrigins: ["*"],
  },
  silo: parseSiloConfig(),
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  leadSources: {
    encryptionKey: process.env.LEAD_SOURCE_ENCRYPTION_KEY,
    facebook: {
      appId: process.env.META_APP_ID,
      appSecret: process.env.META_APP_SECRET,
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN,
      redirectUri: process.env.META_REDIRECT_URI,
      graphApiVersion: process.env.META_GRAPH_API_VERSION || "v26.0",
      oauthScopes: (
        process.env.META_OAUTH_SCOPES ||
        "leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_ads,pages_manage_metadata"
      )
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
    googleCalendar: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI,
      oauthScopes: (
        process.env.GOOGLE_CALENDAR_OAUTH_SCOPES ||
        "openid,email,https://www.googleapis.com/auth/calendar.calendarlist.readonly,https://www.googleapis.com/auth/calendar.events"
      )
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
    googleTasks: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_TASKS_REDIRECT_URI,
      oauthScopes: (
        process.env.GOOGLE_TASKS_OAUTH_SCOPES ||
        "openid,email,https://www.googleapis.com/auth/tasks.readonly"
      )
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_FORMS_REDIRECT_URI,
      oauthScopes: (
        process.env.GOOGLE_FORMS_OAUTH_SCOPES ||
        "openid,email,https://www.googleapis.com/auth/drive.metadata.readonly,https://www.googleapis.com/auth/forms.body.readonly,https://www.googleapis.com/auth/forms.responses.readonly"
      )
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    },
  },
};

export { config };
export default config;
