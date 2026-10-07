import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";

export function isPublicAddress(input: string) {
  try {
    let address = ipaddr.parse(input);
    if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
    return address.range() === "unicast";
  } catch { return false; }
}

async function resolvePublic(hostname: string) {
  const lookupHostname = hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain"].includes(lookupHostname.toLowerCase()) || lookupHostname.toLowerCase().endsWith(".local")) throw new Error("订阅地址不能指向本机或局域网");
  const records = net.isIP(lookupHostname) ? [{ address: lookupHostname, family: net.isIP(lookupHostname) }] : await dns.lookup(lookupHostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) throw new Error("订阅地址解析到了非公网 IP");
  return records[0];
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

async function requestOnce(url: URL, maxBytes: number, options: { userAgent?: string; accept?: string } = {}): Promise<{ body?: string; redirect?: URL; contentType?: string }> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("订阅地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("订阅地址不能包含 URL 账号密码");
  const userAgent = options.userAgent || "clash.meta/1.19.0 (OU-YAML; subscription-import)";
  const lookupHostname = url.hostname.replace(/^\[|\]$/g, "");
  const resolved = await resolvePublic(lookupHostname);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: net.isIP(lookupHostname) ? undefined : lookupHostname,
      headers: { Host: url.host, "User-Agent": userAgent, Accept: options.accept || "*/*", "Accept-Encoding": "gzip, deflate, br", Connection: "close", "Cache-Control": "no-cache" },
      timeout: 15_000,
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve({ redirect: new URL(response.headers.location, url) });
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        const statusCode = response.statusCode || 0;
        response.resume();
        const error = new Error(`订阅服务器返回 HTTP ${statusCode}（${url.hostname}${url.pathname || "/"}）`) as Error & { statusCode?: number };
        error.statusCode = statusCode;
        reject(error); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error("订阅内容超过 2MB")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const body = decodeSubscriptionBody(Buffer.concat(chunks), String(response.headers["content-encoding"] || ""), maxBytes);
          resolve({ body, contentType: String(response.headers["content-type"] || "") });
        } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("订阅请求超时")));
    request.on("error", reject);
    request.end();
  });
}

export async function safeFetchText(input: string, maxBytes = 2_000_000) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("订阅地址格式无效"); }
  const readBody = (result: { body?: string; contentType?: string }) => {
    if (result.body === undefined) return undefined;
    const body = result.body.trim();
    if (!body) throw new Error("订阅服务器返回空内容");
    if (result.contentType?.toLowerCase().includes("text/html") && /^<!doctype html|^<html[\s>]/i.test(body)) throw new Error("订阅服务器返回了 HTML 页面，可能需要登录或订阅地址已失效");
    return result.body;
  };
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    try {
      const result = await requestOnce(url, maxBytes);
      const body = readBody(result);
      if (body !== undefined) return body;
      if (!result.redirect) break;
      url = result.redirect;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode !== 403 && statusCode !== 404) throw error;
      try {
        const retry = await requestOnce(url, maxBytes, {
          userAgent: "Mozilla/5.0 (compatible; OU-YAML subscription importer)",
          accept: "text/plain, application/json, application/yaml, */*",
        });
        const retryBody = readBody(retry);
        if (retryBody !== undefined) return retryBody;
        if (!retry.redirect) throw error;
        url = retry.redirect;
      } catch (retryError) {
        const retryStatus = (retryError as { statusCode?: number }).statusCode;
        if (retryStatus) throw new Error(`订阅服务器返回 HTTP ${retryStatus}（已使用兼容请求头重试）`);
        throw retryError;
      }
    }
  }
  throw new Error("订阅重定向次数过多");
}
