import config from "@shared/infra/config";
import {
  EmailTemplate,
  type EmailTemplateType,
} from "@shared/models";
import { DEFAULT_EMAIL_TEMPLATES } from "@shared/seeds/emailTemplates.seed";

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: {
    name: string;
    email: string;
  };
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text?: string;
}

type TemplateVars = Record<string, string>;

const DEFAULT_TEMPLATES = DEFAULT_EMAIL_TEMPLATES.reduce(
  (acc, template) => {
    acc[template.type] = {
      subjectTemplate: template.subjectTemplate,
      htmlTemplate: template.htmlTemplate,
      textTemplate: template.textTemplate,
    };
    return acc;
  },
  {} as Record<EmailTemplateType, { subjectTemplate: string; htmlTemplate: string; textTemplate?: string }>,
);

/**
 * Returns true when EMAIL_PROVIDER is set to a real provider.
 * Used by callers to decide whether to enqueue an email job at all.
 */
export function isEmailEnabled(): boolean {
  return (
    config.email.provider === "ses" ||
    config.email.provider === "smtp" ||
    config.email.provider === "mailhog"
  );
}

function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getTemplate(type: EmailTemplateType): Promise<{
  subjectTemplate: string;
  htmlTemplate: string;
  textTemplate?: string;
}> {
  const template = await EmailTemplate.findOne({ type, isActive: true })
    .select("subjectTemplate htmlTemplate textTemplate")
    .lean();

  if (template) {
    return {
      subjectTemplate: template.subjectTemplate,
      htmlTemplate: template.htmlTemplate,
      textTemplate: template.textTemplate,
    };
  }

  return DEFAULT_TEMPLATES[type];
}

async function buildFromTemplate(type: EmailTemplateType, vars: TemplateVars): Promise<BuiltEmail> {
  try {
    const template = await getTemplate(type);

    return {
      subject: renderTemplate(template.subjectTemplate, vars),
      html: renderTemplate(template.htmlTemplate, vars),
      text: template.textTemplate ? renderTemplate(template.textTemplate, vars) : undefined,
    };
  } catch {
    // Database read/write failed; keep mail flow working with in-memory defaults.
    const defaults = DEFAULT_TEMPLATES[type];
    return {
      subject: renderTemplate(defaults.subjectTemplate, vars),
      html: renderTemplate(defaults.htmlTemplate, vars),
      text: defaults.textTemplate ? renderTemplate(defaults.textTemplate, vars) : undefined,
    };
  }
}

// ── Template builders ────────────────────────────────────────────────────────

function getClientUrl(): string {
  return (config.app.clientUrl || "http://localhost:5173").replace(/\/+$/, "");
}

export async function buildInviteEmail(
  inviterName: string,
  role: string,
  inviteToken: string,
): Promise<BuiltEmail> {
  const inviteUrl = `${getClientUrl()}/auth/accept-invite?token=${encodeURIComponent(inviteToken)}`;

  const safeInviterName = escapeHtml(inviterName);
  const safeRole = escapeHtml(role);

  const titleText = "You have been invited to collaborate in an InteraOne workspace.";
  const bodyText = `<strong>${safeInviterName}</strong> invited you to join their workspace with the <strong>${safeRole}</strong> role.`;

  return buildFromTemplate("invite", {
    inviterName: safeInviterName,
    role: safeRole,
    inviteUrl,
    titleText,
    bodyText,
  });
}

export async function buildWelcomeEmail(name: string, role: string): Promise<BuiltEmail> {
  const loginUrl = `${getClientUrl()}/auth/login`;

  return buildFromTemplate("welcome", {
    name: escapeHtml(name),
    role: escapeHtml(role),
    loginUrl,
  });
}

export async function buildEmailVerificationOTPEmail(
  name: string,
  otp: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("email_verification_otp", {
    name: escapeHtml(name),
    otp: escapeHtml(otp),
  });
}

export async function buildForgotPasswordOTPEmail(
  name: string,
  otp: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("password_reset_otp", {
    name: escapeHtml(name),
    otp: escapeHtml(otp),
  });
}

export async function buildAgentVerificationOTPEmail(
  otp: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("agent_verification_otp", {
    otp: escapeHtml(otp),
  });
}

export async function buildConversationSummaryEmail(
  name: string,
  companyName: string,
  summary: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("conversation_summary", {
    name: escapeHtml(name),
    companyName: escapeHtml(companyName),
    summary: escapeHtml(summary),
  });
}

export type TicketEmailEvent = "created" | "updated" | "resolved" | "closed";

export interface TicketEmailDetails {
  name: string;
  ticketNumber: string;
  title: string;
  status: string;
  priority: string;
  updateSummary?: string;
  resolutionNote?: string;
}

export async function buildTicketLifecycleEmail(
  event: TicketEmailEvent,
  details: TicketEmailDetails,
): Promise<BuiltEmail> {
  return buildFromTemplate(`ticket_${event}` as EmailTemplateType, {
    name: escapeHtml(details.name),
    ticketNumber: escapeHtml(details.ticketNumber),
    title: escapeHtml(details.title),
    status: escapeHtml(details.status),
    priority: escapeHtml(details.priority),
    updateSummary: escapeHtml(details.updateSummary || "The details of your support request have been updated."),
    resolutionNote: escapeHtml(details.resolutionNote || "No additional resolution details were provided."),
  });
}

export async function buildDomainVerificationPendingEmail(
  name: string,
  domain: string,
  token: string,
): Promise<BuiltEmail> {
  const settingsUrl = `${getClientUrl()}/settings/widget`;
  return buildFromTemplate("domain_verification_pending", {
    name: escapeHtml(name),
    domain: escapeHtml(domain),
    token: escapeHtml(token),
    settingsUrl,
  });
}

export async function buildDomainVerificationCompletedEmail(
  name: string,
  domain: string,
): Promise<BuiltEmail> {
  const settingsUrl = `${getClientUrl()}/settings/widget`;
  return buildFromTemplate("domain_verification_completed", {
    name: escapeHtml(name),
    domain: escapeHtml(domain),
    settingsUrl,
  });
}

// ── Billing & channel lifecycle builders ─────────────────────────────────────

export async function buildFreeCreditGrantedEmail(
  name: string,
  creditAmount: string,
  resetDate: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("free_credit_granted", {
    name: escapeHtml(name),
    creditAmount: escapeHtml(creditAmount),
    resetDate: escapeHtml(resetDate),
    dashboardUrl: getClientUrl(),
  });
}

export async function buildUsageThresholdWarningEmail(
  name: string,
  pct: number,
  used: number,
  limit: number,
  resetDate: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("usage_threshold_warning", {
    name: escapeHtml(name),
    pct: String(pct),
    used: String(used),
    limit: String(limit),
    resetDate: escapeHtml(resetDate),
    upgradeUrl: `${getClientUrl()}/settings/billing`,
  });
}

export async function buildUsageExhaustedEmail(
  name: string,
  used: number,
  limit: number,
  resetDate: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("usage_exhausted", {
    name: escapeHtml(name),
    used: String(used),
    limit: String(limit),
    resetDate: escapeHtml(resetDate),
    upgradeUrl: `${getClientUrl()}/settings/billing`,
  });
}

export async function buildSubscriptionActivatedEmail(
  name: string,
  planName: string,
  nextBillingDate: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("subscription_activated", {
    name: escapeHtml(name),
    planName: escapeHtml(planName),
    nextBillingDate: escapeHtml(nextBillingDate),
    dashboardUrl: getClientUrl(),
  });
}

export async function buildChannelVerifiedEmail(
  name: string,
  channelType: string,
  channelName: string,
): Promise<BuiltEmail> {
  return buildFromTemplate("channel_verified", {
    name: escapeHtml(name),
    channelType: escapeHtml(channelType),
    channelName: escapeHtml(channelName),
    dashboardUrl: `${getClientUrl()}/settings/channels`,
  });
}
