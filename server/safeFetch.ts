import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";

type PublicAddress = { address: string; family: number };

export type SubscriptionRequestProfile = {
  name: string;
  userAgent: string;
  accept: string;
  cacheControl?: string;
};

export const subscriptionRequestProfiles: readonly SubscriptionRequestProfile[] = [
  { name: "Clash Meta 兼容", userAgent: "clash-meta/2.4.0", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "Clash Meta", userAgent: "clash.meta/1.19.0", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "ClashMeta", userAgent: "ClashMeta/1.18.0", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "Clash Meta Android", userAgent: "ClashMetaForAndroid/2.11.7.Meta", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "Mihomo", userAgent: "mihomo/1.19.0", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "Clash", userAgent: "ClashforWindows/0.20.39", accept: "application/yaml, text/yaml, text/plain, application/json, */*" },
  { name: "sing-box", userAgent: "sing-box/1.11.0", accept: "application/json, application/yaml, text/plain, */*" },
  { name: "v2rayN", userAgent: "v2rayN/7.0", accept: "text/plain, application/json, application/yaml, */*" },
  { name: "浏览器", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36", accept: "text/plain, application/json, application/yaml, text/yaml, */*" },
  { name: "curl", userAgent: "curl/8.7.1", accept: "*/*", cacheControl: "" },
];

const retryableStatuses = new Set([401, 403, 404, 406, 408, 429, 451, 500, 502, 503, 504]);

export function isPublicAddress(input: string) {
  try {
    let address = ipaddr.parse(input);
    if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
    return address.range() === "unicast";
  } catch { return false; }
}

async function resolvePublic(hostname: string): Promise<PublicAddress[]> {
  const lookupHostname = hostname.replace(/^\[|\]$/g, "");
  const lowerHostname = lookupHostname.toLowerCase();
  if (["localhost", "localhost.localdomain"].includes(lowerHostname) || lowerHostname.endsWith(".local")) throw new Error("订阅地址不能指向本机或局域网");
  const records = net.isIP(lookupHostname) ? [{ address: lookupHostname, family: net.isIP(lookupHostname) }] : await dns.lookup(lookupHostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) throw new Error("订阅地址解析到了非公网 IP");
  const unique = records.filter((record, index) => records.findIndex((item) => item.address === record.address && item.family === record.family) === index);
  return unique.sort((left, right) => Number(right.family === 4) - Number(left.family === 4)).slice(0, 8);
}

export function decodeSubscriptionBody(payload: Buffer, contentEncoding: string, maxBytes: number) {
  let body = payload;
  const encoding = contentEncoding.split(",")[0].trim().toLowerCase();
  try {
    const options = { maxOutputLength: maxBytes };
    if (encoding === "br") body = brotliDecompressSync(body, options);
    else if (encoding === "gzip") body = gunzipSync(body, options);
    else if (encoding === "deflate") body = inflateSync(body, options);
  } catch {
    throw new Error("订阅解压后的内容超过大小限制或压缩格式无效");
  }
  if (body.length > maxBytes) throw new Error("订阅解压后的内容超过大小限制");
  return body.toString("utf8");
}

type RequestOptions = Partial<Pick<SubscriptionRequestProfile, "userAgent" | "accept" | "cacheControl">> & { skipCertVerify?: boolean };
type RequestResult = { statusCode: number; body?: string; redirect?: URL; contentType?: string; address: string };

function hostHeader(url: URL) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const formattedHostname = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  return url.port && url.port !== defaultPort ? `${formattedHostname}:${url.port}` : formattedHostname;
}

async function requestAtAddress(url: URL, address: PublicAddress, maxBytes: number, options: RequestOptions): Promise<RequestResult> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("订阅地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("订阅地址不能包含 URL 账号密码");
  const userAgent = options.userAgent || subscriptionRequestProfiles[0].userAgent;
  const lookupHostname = url.hostname.replace(/^\[|\]$/g, "");
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname || "/"}${url.search}`,
      method: "GET",
      servername: net.isIP(lookupHostname) ? undefined : lookupHostname,
      rejectUnauthorized: options.skipCertVerify !== true,
      headers: {
        Host: hostHeader(url),
        "User-Agent": userAgent,
        Accept: options.accept || "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Connection: "close",
        ...(options.cacheControl === "" ? {} : { "Cache-Control": options.cacheControl || "no-cache", Pragma: "no-cache" }),
      },
      timeout: 15_000,
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        try { resolve({ statusCode: response.statusCode, redirect: new URL(response.headers.location, url), address: address.address }); }
        catch (error) { reject(error); }
        return;
      }
      const statusCode = response.statusCode || 0;
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        resolve({ statusCode, contentType: String(response.headers["content-type"] || ""), address: address.address });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
          request.destroy(new Error("订阅内容超过 2MB"));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        try {
          const body = decodeSubscriptionBody(Buffer.concat(chunks), String(response.headers["content-encoding"] || ""), maxBytes);
          resolve({ statusCode, body, contentType: String(response.headers["content-type"] || ""), address: address.address });
        } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("订阅请求超时")));
    request.on("error", reject);
    request.end();
  });
}

async function requestOnce(url: URL, maxBytes: number, options: RequestOptions = {}): Promise<RequestResult> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("订阅地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("订阅地址不能包含 URL 账号密码");
  const addresses = await resolvePublic(url.hostname);
  let lastResult: RequestResult | undefined;
  let lastError: unknown;
  for (const address of addresses) {
    try {
      const result = await requestAtAddress(url, address, maxBytes, options);
      if (result.redirect || (result.statusCode >= 200 && result.statusCode < 300)) return result;
      lastResult = result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResult) return lastResult;
  if (lastError) throw lastError;
  throw new Error("订阅服务器没有返回有效响应");
}

type BodyError = Error & { reason?: "empty" | "html" };

function bodyError(message: string, reason: BodyError["reason"]): BodyError {
  const error = new Error(message) as BodyError;
  error.reason = reason;
  return error;
}

function readBody(result: RequestResult) {
  if (result.body === undefined) return undefined;
  const body = result.body.trim();
  if (!body) throw bodyError("订阅服务器返回空内容", "empty");
  const looksLikeHtml = /^<!doctype html|^<html(?:\s|>)|^<head(?:\s|>)/i.test(body);
  if (looksLikeHtml) throw bodyError("订阅服务器返回了 HTML 页面，可能需要登录或订阅地址已失效", "html");
  return result.body;
}

function displayUrl(url: URL) {
  return `${url.hostname}${url.pathname || "/"}`;
}

function statusError(url: URL, statusCode: number, profiles: readonly SubscriptionRequestProfile[]) {
  const tried = profiles.map((profile) => profile.name).join("、");
  const hint = statusCode === 404
    ? "请确认订阅地址完整、未过期，并检查是否需要客户端专用参数"
    : statusCode === 401 || statusCode === 403
      ? "请确认订阅地址仍有效，且服务端没有要求额外鉴权"
      : "请稍后重试或检查服务端访问限制";
  return new Error(`订阅服务器返回 HTTP ${statusCode}（${displayUrl(url)}）。已尝试 ${tried} 请求方式；${hint}`);
}

export type SafeFetchOptions = { userAgent?: string; skipCertVerify?: boolean };
export type SafeFetchResult = { text: string; requestProfile: string };

export async function safeFetchSubscription(input: string, maxBytes = 2_000_000, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("订阅地址格式无效"); }
  const customProfile = options.userAgent?.trim()
    ? [{ name: "自定义 UA", userAgent: options.userAgent.trim().slice(0, 300), accept: "application/yaml, text/yaml, text/plain, application/json, */*" }]
    : [];
  const profiles = [...customProfile, ...subscriptionRequestProfiles.filter((profile) => profile.userAgent !== customProfile[0]?.userAgent)];
  const visited = new Set<string>();
  for (let redirects = 0; redirects < 4; redirects += 1) {
    if (visited.has(url.href)) throw new Error("订阅重定向形成循环");
    visited.add(url.href);
    let redirected: URL | undefined;
    let lastStatus = 0;
    let lastBodyError: BodyError | undefined;
    for (const profile of profiles) {
      const result = await requestOnce(url, maxBytes, { ...profile, skipCertVerify: options.skipCertVerify });
      if (result.redirect) {
        redirected = result.redirect;
        break;
      }
      if (result.statusCode >= 200 && result.statusCode < 300) {
        try {
          const body = readBody(result);
          if (body !== undefined) return { text: body, requestProfile: profile.name };
        } catch (error) {
          const typed = error as BodyError;
          if (typed.reason !== "html") throw error;
          lastBodyError = typed;
        }
        continue;
      }
      lastStatus = result.statusCode;
      if (!retryableStatuses.has(result.statusCode)) throw statusError(url, result.statusCode, [profile]);
    }
    if (redirected) {
      url = redirected;
      continue;
    }
    if (lastBodyError) throw lastBodyError;
    if (lastStatus) throw statusError(url, lastStatus, profiles);
    throw new Error("订阅服务器没有返回有效内容");
  }
  throw new Error("订阅重定向次数过多");
}

export async function safeFetchText(input: string, maxBytes = 2_000_000, options: SafeFetchOptions = {}) {
  return (await safeFetchSubscription(input, maxBytes, options)).text;
}
