import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";

export function isPublicAddress(input: string) {
  try {
    let address = ipaddr.parse(input);
    if (address.kind() === "ipv6" && (address as ipaddr.IPv6).isIPv4MappedAddress()) address = (address as ipaddr.IPv6).toIPv4Address();
    return address.range() === "unicast";
  } catch { return false; }
}

async function resolvePublic(hostname: string) {
  if (["localhost", "localhost.localdomain"].includes(hostname.toLowerCase()) || hostname.toLowerCase().endsWith(".local")) throw new Error("订阅地址不能指向本机或局域网");
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) throw new Error("订阅地址解析到了非公网 IP");
  return records[0];
}

async function requestOnce(url: URL, maxBytes: number): Promise<{ body?: string; redirect?: URL }> {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("订阅地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("订阅地址不能包含 URL 账号密码");
  const resolved = await resolvePublic(url.hostname);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      headers: { Host: url.host, "User-Agent": "OU-YAML/0.2", Accept: "text/plain, application/yaml, application/json", "Accept-Encoding": "identity" },
      timeout: 15_000,
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve({ redirect: new URL(response.headers.location, url) });
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume(); reject(new Error(`订阅服务器返回 HTTP ${response.statusCode || 0}`)); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error("订阅内容超过 2MB")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy(new Error("订阅请求超时")));
    request.on("error", reject);
    request.end();
  });
}

export async function safeFetchText(input: string, maxBytes = 2_000_000) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("订阅地址格式无效"); }
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const result = await requestOnce(url, maxBytes);
    if (result.body !== undefined) return result.body;
    if (!result.redirect) break;
    url = result.redirect;
  }
  throw new Error("订阅重定向次数过多");
}
