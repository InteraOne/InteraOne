import { chromium, Browser, Page } from "playwright";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface FetchedPage {
  url: string;
  text: string;
}

const USER_AGENT = "InteraOne/1.0 (knowledge indexer)";
const NAVIGATION_TIMEOUT = 20_000;
const DEFAULT_MAX_PAGES = parsePositiveInteger(process.env.CRAWLER_MAX_PAGES, 150);
const DEFAULT_REQUEST_DELAY_MS = parseNonNegativeInteger(
  process.env.CRAWLER_REQUEST_DELAY_MS,
  500,
);
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "media", "font"]);

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const STATIC_EXTENSIONS = new Set([
  "css", "js", "mjs", "cjs", "map",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif", "tiff",
  "woff", "woff2", "ttf", "eot", "otf",
  "zip", "gz", "tar", "rar", "7z", "exe", "dmg", "pkg", "deb", "rpm",
  "mp3", "mp4", "webm", "ogg", "wav", "avi", "mov", "mkv", "flac",
  "pdf", "docx", "doc", "xlsx", "pptx",
  "json", "xml", "csv", "yaml", "yml",
]);

/**
 * Default URL patterns that are skipped during crawling.
 * These are designed to prevent infinite crawl explosion on blogs and CMSs.
 */
export const DEFAULT_SKIP_PATTERNS: RegExp[] = [
  // Pagination
  /\/page\/\d+\/?$/i,
  /\?.*\b(page|p|offset|start|limit)=\d+/i,
  // Date archives (e.g., /2024/01/ or /2024/01/15/)
  /\/(20\d{2}|19\d{2})\/(\d{2}|\/)/i,
  /\/archive(s)?\//i,
  // Taxonomies
  /\/(tag|tags|category|categories|author|topic|label|labels)\/[^/]+\/?$/i,
  // Feeds
  /\/(feed|rss|atom|json|xml)\/?$/i,
  // Search / sort / filter query params
  /\?.*\b(search|q|query|sort|order|filter|ref|source)=/i,
  // Print / reply / comment permalinks
  /\?.*\b(print|replytocom|share|like)=/i,
  // Tracking params (safety net)
  /\?.*\b(utm_|fbclid|gclid|ttclid|mc_cid|mc_eid|dclid|srsltid)=/i,
  // CMS layout variants
  /\?.*\b(view|layout|tmpl|template|theme|skin|device|mobile)=/i,
];

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "ttclid", "dclid", "srsltid", "wbraid", "gbraid",
  "mc_cid", "mc_eid", "ref", "source", "medium", "campaign",
]);

const hostSafetyCache = new Map<string, Promise<void>>();

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function ipv6ToBytes(address: string): number[] | null {
  let normalized = address;
  const dottedIpv4 = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedIpv4) {
    const octets = dottedIpv4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    normalized = `${normalized.slice(0, -dottedIpv4.length)}${replacement}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 255);
  }
  return bytes;
}

function isPrivateIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const version = isIP(normalized);

  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;

  const bytes = ipv6ToBytes(normalized);
  if (!bytes) return true;
  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const isIpv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 255 &&
    bytes[11] === 255;
  const isIpv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (isIpv4Mapped || isIpv4Compatible) {
    return isPrivateIpv4(bytes.slice(12).join("."));
  }
  return (
    isUnspecified ||
    isLoopback ||
    (bytes[0] & 0xfe) === 0xfc ||
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    bytes[0] === 0xff ||
    (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
  );
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    throw new Error(`Private or local hostname is not allowed: ${hostname}`);
  }

  if (isIP(normalized)) {
    if (isPrivateIpAddress(normalized)) {
      throw new Error(`Private or reserved IP address is not allowed: ${hostname}`);
    }
    return;
  }

  let cached = hostSafetyCache.get(normalized);
  if (!cached) {
    cached = lookup(normalized, { all: true, verbatim: true }).then((addresses) => {
      if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address))) {
        throw new Error(`Hostname resolves to a private or reserved IP address: ${hostname}`);
      }
    });
    hostSafetyCache.set(normalized, cached);
  }

  try {
    await cached;
  } catch (error) {
    hostSafetyCache.delete(normalized);
    throw error;
  }
}

async function assertSafePublicUrl(urlString: string): Promise<URL> {
  const url = new URL(urlString);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("URLs containing credentials are not allowed");
  }
  await assertPublicHostname(url.hostname);
  return url;
}

function isStaticAssetUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    return !!ext && STATIC_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function stripTrackingParams(url: URL): void {
  url.searchParams.forEach((_, key) => {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  });
}

/**
 * Normalize a URL for deduplication:
 *  - lowercase hostname
 *  - strip www prefix
 *  - strip fragment
 *  - strip tracking query params
 *  - sort remaining query params
 *  - remove trailing slash (except root)
 *  - reject static assets and cross-origin (if rootHostname provided)
 */
export function normalizeUrl(url: string, rootHostname?: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;

    parsed.hostname = parsed.hostname.toLowerCase();

    if (parsed.hostname.startsWith("www.")) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    parsed.hash = "";
    stripTrackingParams(parsed);

    const sortedEntries = [...parsed.searchParams].sort((a, b) => a[0].localeCompare(b[0]));
    const sortedParams = new URLSearchParams(sortedEntries);
    parsed.search = sortedParams.toString() ? `?${sortedParams.toString()}` : "";

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    const normalized = parsed.toString();
    if (isStaticAssetUrl(normalized)) return null;
    const normalizedRootHostname = rootHostname?.toLowerCase().replace(/^www\./, "");
    if (normalizedRootHostname && parsed.hostname !== normalizedRootHostname) return null;

    return normalized;
  } catch {
    return null;
  }
}

function normalizeSameOriginCandidate(candidate: string, root: URL): string | null {
  try {
    const url = new URL(candidate, root.origin);
    const rootHostname = root.hostname.toLowerCase().replace(/^www\./, "");
    return normalizeUrl(url.toString(), rootHostname);
  } catch {
    return null;
  }
}

async function extractTextFromPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const selectorsToRemove = [
      "script", "style", "noscript", "iframe", "nav", "header", "footer",
      "aside", ".sidebar", "#sidebar", ".menu", "#menu", ".navigation",
      ".ads", ".advertisement", ".cookie-banner", ".modal", "dialog",
      ".comments", "#comments", ".comment-list", "#comment-list",
    ];
    selectorsToRemove.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => el.remove());
    });

    const main =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector('[role="main"]') ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.querySelector(".post") ||
      document.querySelector(".entry") ||
      document.body;

    if (!main) return "";

    let text = main.innerText || main.textContent || "";
    text = text.replace(/\t+/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return text;
  });
}

async function extractCanonicalUrl(
  page: Page,
  pageUrl: string,
  rootHostname: string,
): Promise<string | null> {
  try {
    const canonical = await page.evaluate(() => {
      const link = document.querySelector("link[rel='canonical']");
      return link?.getAttribute("href") || null;
    });
    if (!canonical) return null;
    return normalizeUrl(new URL(canonical, pageUrl).toString(), rootHostname) || null;
  } catch {
    return null;
  }
}

async function extractLinks(
  page: Page,
  pageUrl: string,
  rootHostname: string,
): Promise<string[]> {
  const rawLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => !!href);
  });

  const seen = new Set<string>();

  for (const href of rawLinks) {
    try {
      const resolved = new URL(href, pageUrl);
      resolved.hash = "";
      const normalized = normalizeUrl(resolved.toString(), rootHostname);
      if (normalized && !isStaticAssetUrl(normalized)) {
        seen.add(normalized);
      }
    } catch {
      // skip malformed
    }
  }

  return [...seen];
}

async function discoverSitemapCandidates(rootUrl: string): Promise<string[]> {
  const root = new URL(rootUrl);
  const rootHostname = root.hostname.toLowerCase().replace(/^www\./, "");
  const candidates = new Set<string>();

  const addCandidate = (value: string) => {
    const normalized = normalizeSameOriginCandidate(value, root);
    if (normalized) candidates.add(normalized);
  };

  const fetchText = async (url: string): Promise<string | null> => {
    try {
      let currentUrl = url;
      for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
        const safeUrl = await assertSafePublicUrl(currentUrl);
        const hostname = safeUrl.hostname.toLowerCase().replace(/^www\./, "");
        if (hostname !== rootHostname) return null;

        const res = await fetch(safeUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "application/xml,text/xml,text/plain,*/*",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) return null;
          currentUrl = new URL(location, safeUrl).toString();
          continue;
        }
        if (!res.ok) return null;

        const contentLength = Number.parseInt(res.headers.get("content-length") || "0", 10);
        if (contentLength > MAX_SITEMAP_BYTES) return null;
        const body = await res.arrayBuffer();
        if (body.byteLength > MAX_SITEMAP_BYTES) return null;
        return new TextDecoder().decode(body);
      }
      return null;
    } catch {
      return null;
    }
  };

  const sitemapXml = await fetchText(`${root.origin}/sitemap.xml`);
  if (sitemapXml) {
    for (const match of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const value = match[1]?.trim();
      if (value) addCandidate(value);
    }
  }

  const robotsText = await fetchText(`${root.origin}/robots.txt`);
  if (robotsText) {
    const sitemapLines = robotsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^sitemap:/i.test(line));

    for (const line of sitemapLines) {
      const sitemapUrl = line.replace(/^sitemap:\s*/i, "").trim();
      if (!sitemapUrl) continue;
      const xml = await fetchText(sitemapUrl);
      if (!xml) continue;
      for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
        const value = match[1]?.trim();
        if (value) addCandidate(value);
      }
    }
  }

  return [...candidates];
}

interface PageFetchResult {
  url: string;
  text: string;
  links: string[];
  canonicalUrl: string | null;
  isCanonicalDuplicate: boolean;
}

async function configurePageNetworkSafety(page: Page, rootHostname: string): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      await route.abort();
      return;
    }

    try {
      const requestUrl = request.url();
      const parsed = new URL(requestUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        await route.abort();
        return;
      }
      if (request.isNavigationRequest() && !normalizeUrl(requestUrl, rootHostname)) {
        await route.abort();
        return;
      }
      await assertSafePublicUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}

async function fetchPageWithPlaywright(
  browser: Browser,
  url: string,
  skipPatterns: RegExp[],
  rootHostname: string,
): Promise<PageFetchResult | null> {
  for (const pattern of skipPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(url)) {
      console.log(`[Crawler] Skipping URL by pattern: ${url}`);
      return null;
    }
  }

  const page = await browser.newPage({
    userAgent: USER_AGENT,
  });

  try {
    await assertSafePublicUrl(url);
    await configurePageNetworkSafety(page, rootHostname);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    // Brief pause for JS-rendered content to settle
    await page.waitForTimeout(300);

    const contentType = response?.headers()?.["content-type"] || "";
    if (contentType && !contentType.toLowerCase().includes("text/html")) {
      console.log(`[Crawler] Skipping non-HTML content (${contentType}): ${url}`);
      return null;
    }

    const finalUrl = normalizeUrl(page.url(), rootHostname);
    if (!finalUrl) {
      console.log(`[Crawler] Skipping cross-origin redirect from: ${url}`);
      return null;
    }

    const canonicalUrl = await extractCanonicalUrl(page, finalUrl, rootHostname);

    // If canonical points to a different normalized URL, this page is a duplicate
    if (canonicalUrl && canonicalUrl !== finalUrl) {
      return {
        url: canonicalUrl,
        text: "",
        links: [],
        canonicalUrl,
        isCanonicalDuplicate: true,
      };
    }

    const text = await extractTextFromPage(page);
    const links = await extractLinks(page, finalUrl, rootHostname);

    return {
      url: finalUrl,
      text,
      links,
      canonicalUrl,
      isCanonicalDuplicate: false,
    };
  } catch (err: any) {
    console.warn(`[Crawler] Error fetching ${url}: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

function hashContent(text: string): string {
  const sample = text.slice(0, 1500).replace(/\s+/g, " ").trim();
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash) + sample.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/** Fetch only the given URL and return its text content */
export async function fetchSinglePage(url: string): Promise<FetchedPage[]> {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error(`Invalid or unsupported URL: ${url}`);
  await assertSafePublicUrl(normalized);

  const rootHostname = new URL(normalized).hostname;
  const browser = await chromium.launch({ headless: true });
  try {
    let result = await fetchPageWithPlaywright(browser, normalized, [], rootHostname);
    if (result?.isCanonicalDuplicate && result.canonicalUrl) {
      result = await fetchPageWithPlaywright(browser, result.canonicalUrl, [], rootHostname);
    }
    if (!result || result.isCanonicalDuplicate || !result.text.trim()) return [];
    return [{ url: result.url, text: result.text }];
  } finally {
    await browser.close();
  }
}

/**
 * BFS-crawl starting from `rootUrl` up to `maxDepth` levels.
 * Yields pages one-by-one as they are fetched so the pipeline can flush
 * embeddings in configurable page-count batches without waiting for the
 * entire crawl to finish.
 *
 * Safety features:
 *  - maxPages hard cap (default 150, configurable with CRAWLER_MAX_PAGES)
 *  - URL normalization (tracking params, fragments, www, trailing slashes)
 *  - Canonical link handling (skips duplicates, queues canonical target)
 *  - Content-hash deduplication (skips pages with identical text)
 *  - URL pattern blacklist for blog/CMS explosion (/page/N, /tag/…, /2024/…)
 *  - Request delay between pages (rate limiting)
 */
export async function* crawlPages(
  rootUrl: string,
  maxDepth: number,
  options?: {
    maxPages?: number;
    requestDelayMs?: number;
    skipPatterns?: RegExp[];
    respectCanonical?: boolean;
    deduplicateByContent?: boolean;
  },
): AsyncGenerator<FetchedPage> {
  const {
    maxPages = DEFAULT_MAX_PAGES,
    requestDelayMs = DEFAULT_REQUEST_DELAY_MS,
    skipPatterns = DEFAULT_SKIP_PATTERNS,
    respectCanonical = true,
    deduplicateByContent = true,
  } = options || {};

  const normalizedRoot = normalizeUrl(rootUrl);
  if (!normalizedRoot) throw new Error(`Invalid or unsupported URL: ${rootUrl}`);
  await assertSafePublicUrl(normalizedRoot);

  const rootHostname = new URL(normalizedRoot).hostname;
  const effectiveMaxDepth = Math.max(0, Math.min(5, Math.trunc(maxDepth)));
  const effectiveMaxPages = Math.max(1, Math.trunc(maxPages));
  const effectiveRequestDelayMs = Math.max(0, Math.trunc(requestDelayMs));

  const browser = await chromium.launch({ headless: true });
  try {
    const visited = new Set<string>();
    const queued = new Set<string>();
    const contentHashes = new Set<string>();
    let totalYielded = 0;
    let lastRequestStartedAt = 0;

    const queue: Array<[string, number]> = [[normalizedRoot, 0]];
    queued.add(normalizedRoot);

    if (effectiveMaxDepth > 0) {
      try {
        const sitemapCandidates = await discoverSitemapCandidates(normalizedRoot);
        if (sitemapCandidates.length > 0) {
          console.log(
            `[Crawler] Seeded ${sitemapCandidates.length} URL(s) from sitemap/robots for ${rootHostname}`,
          );
          for (const url of sitemapCandidates) {
            const normalized = normalizeUrl(url, rootHostname);
            if (!normalized || queued.has(normalized)) continue;
            queued.add(normalized);
            queue.push([normalized, 1]);
          }
        }
      } catch (err: any) {
        console.warn(`[Crawler] Sitemap discovery failed: ${err.message}`);
      }
    }

    while (queue.length > 0) {
      if (totalYielded >= effectiveMaxPages) {
        console.log(`[Crawler] Reached maxPages limit (${effectiveMaxPages}). Stopping.`);
        break;
      }

      const [currentUrl, depth] = queue.shift()!;
      const normalizedCurrent = normalizeUrl(currentUrl, rootHostname);

      if (!normalizedCurrent || visited.has(normalizedCurrent)) continue;
      if (isStaticAssetUrl(normalizedCurrent)) continue;

      visited.add(normalizedCurrent);

      const waitBeforeRequest = Math.max(
        0,
        effectiveRequestDelayMs - (Date.now() - lastRequestStartedAt),
      );
      if (lastRequestStartedAt > 0 && waitBeforeRequest > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitBeforeRequest));
      }
      lastRequestStartedAt = Date.now();

      const result = await fetchPageWithPlaywright(
        browser,
        normalizedCurrent,
        skipPatterns,
        rootHostname,
      );
      if (!result) continue;

      // Canonical normalization: if this page says it's a duplicate, queue the canonical instead
      if (respectCanonical && result.isCanonicalDuplicate && result.canonicalUrl) {
        if (!visited.has(result.canonicalUrl) && !queued.has(result.canonicalUrl)) {
          console.log(`[Crawler] Queuing canonical target: ${result.canonicalUrl}`);
          queued.add(result.canonicalUrl);
          queue.push([result.canonicalUrl, depth]);
        }
        continue;
      }

      // Content-level deduplication
      if (deduplicateByContent && result.text.trim()) {
        const hashStr = hashContent(result.text);
        if (contentHashes.has(hashStr)) {
          console.log(`[Crawler] Skipping duplicate content: ${normalizedCurrent}`);
          continue;
        }
        contentHashes.add(hashStr);
      }

      if (result.text.trim()) {
        totalYielded++;
        console.log(`[Crawler] Yielding page ${totalYielded} (depth ${depth}): ${result.url}`);
        yield { url: result.url, text: result.text };
      }

      if (depth < effectiveMaxDepth) {
        if (result.links.length === 0) {
          console.log(`[Crawler] No same-origin links found on: ${normalizedCurrent}`);
        }
        for (const link of result.links) {
          const normalizedLink = normalizeUrl(link, rootHostname);
          if (!normalizedLink) continue;
          if (visited.has(normalizedLink) || queued.has(normalizedLink)) continue;
          if (isStaticAssetUrl(normalizedLink)) continue;

          queued.add(normalizedLink);
          queue.push([normalizedLink, depth + 1]);
        }
      }

    }
  } finally {
    await browser.close();
  }
}
