import { randomBytes } from "crypto";
import { resolveCname, resolveTxt } from "dns/promises";
import { isIP } from "net";
import { connect } from "tls";
import { domainToASCII } from "url";
import config from "@shared/infra/config";
import { AppError } from "@shared/core/errors";
import { Organization, ThreadDomain } from "@shared/models";

const reserved = new Set(["localhost", "localhost.localdomain"]);

export function normalizeThreadHostname(input: unknown) {
  if (typeof input !== "string") throw new AppError("Enter a valid domain", 400);
  let raw = input.trim().toLowerCase();
  if (!raw) throw new AppError("Enter a valid domain", 400);
  if (!raw.includes("://")) raw = "https://" + raw;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError("Enter a valid domain", 400);
  }
  const hostname = domainToASCII(parsed.hostname).toLowerCase().replace(/\.$/, "");
  if (
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !hostname ||
    hostname.length > 253 ||
    isIP(hostname) ||
    reserved.has(hostname) ||
    hostname.endsWith(".localhost") ||
    !hostname.includes(".") ||
    !hostname.split(".").every((label) =>
      /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label),
    )
  ) {
    throw new AppError("Enter a public domain without a path or port", 400);
  }
  return hostname;
}

export function hostedPortalUrl(slug: string) {
  return new URL(`/threads/${encodeURIComponent(slug)}`, config.app.clientUrl).href;
}

export function threadDomainTarget() {
  try {
    const hostname = new URL(config.app.apiUrl).hostname
      .toLowerCase()
      .replace(/\.$/, "");
    return hostname && !isIP(hostname) && !reserved.has(hostname)
      ? hostname
      : undefined;
  } catch {
    return undefined;
  }
}

export async function portalUrl(organizationId: unknown, slug: string) {
  const domain = await ThreadDomain.findOne({
    organizationId,
    status: "active",
    tlsStatus: "active",
  })
    .sort({ createdAt: 1 })
    .select("hostname")
    .lean();
  return domain ? `https://${domain.hostname}` : hostedPortalUrl(slug);
}

export function domainDto(domain: {
  _id: unknown;
  hostname: string;
  verificationToken: string;
  status: string;
  tlsStatus: string;
  ownershipVerifiedAt?: Date;
  routingVerifiedAt?: Date;
  tlsVerifiedAt?: Date;
  lastCheckedAt?: Date;
  lastError?: string;
}) {
  const target = threadDomainTarget();
  return {
    id: String(domain._id),
    hostname: domain.hostname,
    status: domain.status,
    tlsStatus: domain.tlsStatus,
    ownershipVerifiedAt: domain.ownershipVerifiedAt,
    routingVerifiedAt: domain.routingVerifiedAt,
    tlsVerifiedAt: domain.tlsVerifiedAt,
    lastCheckedAt: domain.lastCheckedAt,
    lastError: domain.lastError,
    url:
      domain.status === "active" && domain.tlsStatus === "active"
        ? `https://${domain.hostname}`
        : undefined,
    dnsRecords: [
          {
            type: "TXT" as const,
            name: `_interaone-challenge.${domain.hostname}`,
            value: domain.verificationToken,
            purpose: "Proves ownership of this domain",
          },
          ...(target ? [
          {
            type: "CNAME" as const,
            name: domain.hostname,
            value: target,
            purpose: "Routes your support portal to InteraOne",
          },
          ] : []),
        ],
  };
}

export async function createDomain(organizationId: string, input: unknown) {
  const target = threadDomainTarget();
  const hostname = normalizeThreadHostname(input);
  if (hostname === target)
    throw new AppError("This hostname is reserved by the deployment", 409);
  try {
    return await ThreadDomain.create({
      organizationId,
      hostname,
      verificationToken: "interaone-verification=" + randomBytes(24).toString("hex"),
      tlsStatus:
        config.app.threads.tlsMode === "disabled" ? "disabled" : "pending",
    });
  } catch (error: any) {
    if (error?.code === 11000)
      throw new AppError("This domain is already connected to an organization", 409);
    throw error;
  }
}

async function ownsDomain(hostname: string, token: string) {
  try {
    const records = await resolveTxt(`_interaone-challenge.${hostname}`);
    return records.some((parts) => parts.join("").trim() === token);
  } catch {
    return false;
  }
}

async function routesToInteraOne(hostname: string, target: string) {
  try {
    const records = await resolveCname(hostname);
    return records.some(
      (record) => record.toLowerCase().replace(/\.$/, "") === target,
    );
  } catch {
    return false;
  }
}

async function hasValidTls(hostname: string) {
  return new Promise<boolean>((resolve) => {
    const socket = connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: true },
      () => {
        const certificate = socket.getPeerCertificate();
        const valid = Boolean(certificate?.valid_to);
        socket.end();
        resolve(valid);
      },
    );
    socket.setTimeout(7000);
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function verifyDomain(organizationId: string, id: string) {
  const domain = await ThreadDomain.findOne({ _id: id, organizationId });
  if (!domain) throw new AppError("Domain not found", 404);
  const target = threadDomainTarget();

  domain.lastCheckedAt = new Date();
  domain.lastError = undefined;
  const [owned, routed] = await Promise.all([
    ownsDomain(domain.hostname, domain.verificationToken),
    target ? routesToInteraOne(domain.hostname, target) : Promise.resolve(false),
  ]);
  if (owned) domain.ownershipVerifiedAt ||= new Date();
  if (!owned || !routed) {
    domain.status = "pending_dns";
    domain.lastError = !owned
      ? "Ownership TXT record was not found"
      : target
        ? `CNAME does not point to ${target}`
        : "Ownership verified. Portal routing is awaiting deployment configuration.";
    await domain.save();
    return domain;
  }

  domain.ownershipVerifiedAt ||= new Date();
  domain.routingVerifiedAt ||= new Date();
  domain.status = "verified";
  if (config.app.threads.tlsMode === "disabled") {
    domain.tlsStatus = "disabled";
    domain.lastError =
      "DNS is verified, but automatic TLS is disabled for this deployment";
    await domain.save();
    return domain;
  }

  domain.status = "provisioning";
  domain.tlsStatus = "provisioning";
  await domain.save();
  if (await hasValidTls(domain.hostname)) {
    domain.status = "active";
    domain.tlsStatus = "active";
    domain.tlsVerifiedAt = new Date();
  } else {
    domain.lastError =
      "DNS is verified. TLS is still provisioning; check again shortly.";
  }
  await domain.save();
  return domain;
}

export async function resolvePortalOrganization(hostHeader: string | undefined) {
  const hostname = normalizeThreadHostname(hostHeader?.split(":")[0] || "");
  const custom = await ThreadDomain.findOne({
    hostname,
    status: "active",
    tlsStatus: "active",
  }).lean();
  if (custom)
    return Organization.findOne({
      _id: custom.organizationId,
      isActive: true,
      threadsEnabled: true,
    });

  return null;
}
