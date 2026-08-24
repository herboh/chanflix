import { isIP } from "net";

const DEFAULT_SEARXNG_BASE_URL = "https://search.chanflix.com";
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 4;
const MAX_RESULTS = 4;
const MAX_QUERY_CHARS = 300;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_CANDIDATES = 32;
const MAX_RESULT_URL_CHARS = 2_048;
const MAX_TITLE_CHARS = 200;
const MAX_SNIPPET_CHARS = 600;

export interface WebSearchItem {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  date?: string;
}

export type WebSearchErrorCode =
  | "invalid_query"
  | "invalid_configuration"
  | "timeout"
  | "unavailable"
  | "invalid_response";

export type WebSearchResult =
  | {
      ok: true;
      query: string;
      results: WebSearchItem[];
      /** Search results are external data, never trusted instructions. */
      untrusted: true;
    }
  | {
      ok: false;
      code: WebSearchErrorCode;
      message: string;
      retryable: boolean;
    };

interface SearxngResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  snippet?: unknown;
  publishedDate?: unknown;
  published_date?: unknown;
}

interface WebSearchOptions {
  baseUrl?: string;
  maxResults?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

class WebSearchFailure extends Error {
  constructor(public readonly code: WebSearchErrorCode) {
    super(code);
  }
}

const publicError = (
  code: WebSearchErrorCode,
  message: string,
  retryable: boolean
): WebSearchResult => ({ ok: false, code, message, retryable });

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
};

const normalizeQuery = (value: string): string | undefined => {
  if (typeof value !== "string" || value.length > MAX_QUERY_CHARS) return;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) return;

  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return query && query.length <= MAX_QUERY_CHARS ? query : undefined;
};

const normalizeText = (value: unknown, maxChars: number): string => {
  if (typeof value !== "string") return "";

  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxChars);
};

const parseIpv4 = (address: string): number[] | undefined => {
  if (isIP(address) !== 4) return;
  const octets = address.split(".").map(Number);
  return octets.length === 4 ? octets : undefined;
};

const isPublicIpv4 = (address: string): boolean => {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const parseIpv6 = (address: string): number[] | undefined => {
  if (isIP(address) !== 6) return;

  let normalized = address.toLowerCase();
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (ipv4Tail) {
    const octets = parseIpv4(ipv4Tail);
    if (!octets) return;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) |
      octets[3]
    ).toString(16)}`;
    normalized = normalized.slice(0, -ipv4Tail.length) + replacement;
  }

  const sides = normalized.split("::");
  if (sides.length > 2) return;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((sides.length === 1 && missing !== 0) || missing < 0) return;

  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return;
  const bytes: number[] = [];
  for (const group of groups) {
    const parsed = Number.parseInt(group || "0", 16);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffff) return;
    bytes.push(parsed >> 8, parsed & 0xff);
  }
  return bytes;
};

const isPublicIpv6 = (address: string): boolean => {
  const bytes = parseIpv6(address);
  if (!bytes) return false;

  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const isUniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const isLinkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const isMulticast = bytes[0] === 0xff;
  const isDocumentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8;
  const isIpv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const isIpv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);

  if (isIpv4Mapped || isIpv4Compatible) {
    return isPublicIpv4(bytes.slice(12).join("."));
  }

  return !(
    isUnspecified ||
    isLoopback ||
    isUniqueLocal ||
    isLinkLocal ||
    isMulticast ||
    isDocumentation
  );
};

export const isSafePublicWebUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > MAX_RESULT_URL_CHARS) {
    return false;
  }

  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "80" && url.port !== "443")
    ) {
      return false;
    }

    const hostname = url.hostname
      .replace(/^\[|\]$/gu, "")
      .replace(/\.$/u, "")
      .toLowerCase();
    if (!hostname || (!hostname.includes(".") && isIP(hostname) === 0)) {
      return false;
    }
    if (
      hostname === "localhost" ||
      /\.(?:localhost|local|internal|lan|home\.arpa|localdomain|test|invalid)$/u.test(
        hostname
      ) ||
      hostname.endsWith(".onion")
    ) {
      return false;
    }

    const ipVersion = isIP(hostname);
    if (ipVersion === 4) return isPublicIpv4(hostname);
    if (ipVersion === 6) return isPublicIpv6(hostname);
    return true;
  } catch {
    return false;
  }
};

const normalizeResult = (value: unknown): WebSearchItem | undefined => {
  if (!value || typeof value !== "object") return;
  const result = value as SearxngResult;
  const title = normalizeText(result.title, MAX_TITLE_CHARS);
  if (!title || !isSafePublicWebUrl(result.url)) return;

  const parsedUrl = new URL(result.url);
  parsedUrl.hash = "";
  const url = parsedUrl.toString();
  const snippet = normalizeText(
    result.content ?? result.snippet,
    MAX_SNIPPET_CHARS
  );
  const publishedDate = result.publishedDate ?? result.published_date;
  const publishedMs =
    typeof publishedDate === "string" ? Date.parse(publishedDate) : NaN;

  return {
    title,
    url,
    domain: parsedUrl.hostname.replace(/^www\./u, "").toLowerCase(),
    snippet,
    ...(Number.isFinite(publishedMs)
      ? { date: new Date(publishedMs).toISOString() }
      : {}),
  };
};

export const normalizeSearxngResults = (
  payload: unknown,
  maxResults = DEFAULT_MAX_RESULTS
): WebSearchItem[] | undefined => {
  if (!payload || typeof payload !== "object") return;
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return;

  const limit = boundedInteger(maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
  const normalized: WebSearchItem[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of results.slice(0, MAX_RESULT_CANDIDATES)) {
    const result = normalizeResult(candidate);
    if (!result || seenUrls.has(result.url)) continue;
    seenUrls.add(result.url);
    normalized.push(result);
    if (normalized.length === limit) break;
  }

  return normalized;
};

const getSearchUrl = (baseUrl: string, query: string): URL => {
  if (baseUrl.length > MAX_RESULT_URL_CHARS) {
    throw new WebSearchFailure("invalid_configuration");
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new WebSearchFailure("invalid_configuration");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new WebSearchFailure("invalid_configuration");
  }

  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}${
    url.pathname.replace(/\/$/u, "").endsWith("/search") ? "" : "/search"
  }`;
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("safesearch", "1");
  return url;
};

const readBoundedResponse = async (
  response: Response,
  maxBytes: number
): Promise<string> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new WebSearchFailure("invalid_response");
  }
  if (!response.body) throw new WebSearchFailure("invalid_response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new WebSearchFailure("invalid_response");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

export const searchWeb = async (
  rawQuery: string,
  options: WebSearchOptions = {}
): Promise<WebSearchResult> => {
  const query = normalizeQuery(rawQuery);
  if (!query) {
    return publicError(
      "invalid_query",
      `Use a non-empty web search query under ${MAX_QUERY_CHARS} characters.`,
      false
    );
  }

  const maxResults = boundedInteger(
    options.maxResults,
    DEFAULT_MAX_RESULTS,
    1,
    MAX_RESULTS
  );
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    10,
    MAX_TIMEOUT_MS
  );
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    MAX_RESPONSE_BYTES,
    1_024,
    MAX_RESPONSE_BYTES
  );
  const fetchImpl = options.fetchImpl ?? fetch;

  let searchUrl: URL;
  try {
    searchUrl = getSearchUrl(
      options.baseUrl ??
        process.env.SEARXNG_BASE_URL ??
        DEFAULT_SEARXNG_BASE_URL,
      query
    );
  } catch {
    return publicError(
      "invalid_configuration",
      "Web search is not configured correctly.",
      false
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(searchUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Chanflix-AI-WebSearch/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return publicError(
        "unavailable",
        "Web search is temporarily unavailable.",
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.includes("application/json")) {
      await response.body?.cancel();
      return publicError(
        "invalid_response",
        "Web search returned an invalid response.",
        false
      );
    }

    const text = await readBoundedResponse(response, maxResponseBytes);
    const results = normalizeSearxngResults(JSON.parse(text), maxResults);
    if (!results) {
      return publicError(
        "invalid_response",
        "Web search returned an invalid response.",
        false
      );
    }

    return { ok: true, query, results, untrusted: true };
  } catch (error) {
    if (controller.signal.aborted) {
      return publicError(
        "timeout",
        "Web search timed out. Try a narrower query.",
        true
      );
    }
    if (error instanceof WebSearchFailure || error instanceof SyntaxError) {
      return publicError(
        "invalid_response",
        "Web search returned an invalid response.",
        false
      );
    }
    return publicError(
      "unavailable",
      "Web search is temporarily unavailable.",
      true
    );
  } finally {
    clearTimeout(timer);
  }
};
