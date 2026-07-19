import type { ProxyNode } from "./types";

export interface LinkParseError { line: number; input: string; message: string }
export interface LinkParseResult { nodes: ProxyNode[]; errors: LinkParseError[] }

function decodeBase64(value: string): string {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeName(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch { return value; }
}

function hostPort(value: string): { server: string; port: number } {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return { server: value.slice(1, end), port: Number(value.slice(end + 2)) };
  }
  const index = value.lastIndexOf(":");
  return { server: value.slice(0, index), port: Number(value.slice(index + 1)) };
}

function common(name: string, type: string, server: string, port: number): ProxyNode {
  return { id: crypto.randomUUID(), name, type, server, port, udp: true, extra: {} };
}

function parseSs(input: string): ProxyNode {
  const withoutScheme = input.slice(5);
  const [beforeFragment, fragment] = withoutScheme.split("#", 2);
  const [core] = beforeFragment.split("?", 1);
  if (!core.includes("@")) {
    const decoded = decodeBase64(core);
    const at = decoded.lastIndexOf("@");
    if (at < 0) throw new Error("SS 链接缺少服务器信息");
    const credentials = decoded.slice(0, at);
    const address = hostPort(decoded.slice(at + 1));
    const separator = credentials.indexOf(":");
    const node = common(decodeName(fragment, address.server), "ss", address.server, address.port);
    node.cipher = credentials.slice(0, separator);
    node.password = credentials.slice(separator + 1);
    return node;
  }
  const at = core.lastIndexOf("@");
  let credentials = core.slice(0, at);
  try { credentials = decodeBase64(credentials); } catch { credentials = decodeURIComponent(credentials); }
  if (!credentials.includes(":")) credentials = decodeURIComponent(core.slice(0, at));
  const address = hostPort(core.slice(at + 1));
  const separator = credentials.indexOf(":");
  const node = common(decodeName(fragment, address.server), "ss", address.server, address.port);
  node.cipher = credentials.slice(0, separator);
  node.password = credentials.slice(separator + 1);
  return node;
}

function parseVmess(input: string): ProxyNode {
  const payload = JSON.parse(decodeBase64(input.slice("vmess://".length))) as Record<string, unknown>;
  const server = String(payload.add || "");
  const node = common(String(payload.ps || server || "VMess"), "vmess", server, Number(payload.port || 443));
  node.uuid = String(payload.id || "");
  node.cipher = String(payload.scy || "auto");
  node.network = String(payload.net || "tcp");
  node.tls = payload.tls === "tls";
  node.sni = String(payload.sni || payload.host || "") || undefined;
  node.wsHost = String(payload.host || "") || undefined;
  node.wsPath = String(payload.path || "") || undefined;
  node.grpcServiceName = node.network === "grpc" ? String(payload.path || "") || undefined : undefined;
  return node;
}

function parseSsr(input: string): ProxyNode {
  const decoded = decodeBase64(input.slice("ssr://".length));
  const [main, query = ""] = decoded.split("/?", 2);
  const fields = main.split(":");
  if (fields.length < 6) throw new Error("SSR 链接字段不足");
  const params = new URLSearchParams(query);
  const server = fields[0];
  const node = common(params.get("remarks") ? decodeBase64(params.get("remarks")!) : server, "ssr", server, Number(fields[1]));
  node.cipher = fields[3];
  node.password = decodeBase64(fields.slice(5).join(":"));
  node.extra = { protocol: fields[2], obfs: fields[4] };
  const protocolParam = params.get("protoparam");
  const obfsParam = params.get("obfsparam");
  if (protocolParam) node.extra["protocol-param"] = decodeBase64(protocolParam);
  if (obfsParam) node.extra["obfs-param"] = decodeBase64(obfsParam);
  return node;
}

function parseUrlNode(input: string): ProxyNode {
  const url = new URL(input);
  const typeMap: Record<string, string> = { "socks": "socks5", "socks5": "socks5", "hy2": "hysteria2" };
  const type = typeMap[url.protocol.slice(0, -1)] || url.protocol.slice(0, -1);
  const node = common(decodeName(url.hash.slice(1), url.hostname), type, url.hostname, Number(url.port || (url.searchParams.get("tls") ? 443 : 80)));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (type === "vless" || type === "vmess") node.uuid = username;
  else if (type === "tuic") { node.uuid = username; node.password = password; }
  else if (type === "socks5" || type === "http") { node.password = password; if (username) node.extra.username = username; }
  else node.password = username || password;
  node.tls = ["tls", "reality"].includes(url.searchParams.get("security") || "") || url.searchParams.get("tls") === "1";
  node.sni = url.searchParams.get("sni") || url.searchParams.get("peer") || undefined;
  node.skipCertVerify = url.searchParams.get("allowInsecure") === "1" || url.searchParams.get("insecure") === "1";
  node.network = url.searchParams.get("type") || url.searchParams.get("network") || undefined;
  node.wsPath = url.searchParams.get("path") || undefined;
  node.wsHost = url.searchParams.get("host") || undefined;
  node.grpcServiceName = url.searchParams.get("serviceName") || undefined;
  for (const [key, value] of url.searchParams) {
    if (!["security", "tls", "sni", "peer", "allowInsecure", "insecure", "type", "network", "path", "host", "serviceName"].includes(key)) node.extra[key] = value;
  }
  return node;
}

export function parseShareLink(input: string): ProxyNode {
  const value = input.trim();
  if (value.startsWith("ss://")) return parseSs(value);
  if (value.startsWith("ssr://")) return parseSsr(value);
  if (value.startsWith("vmess://")) return parseVmess(value);
  if (/^(vless|trojan|hysteria2|hy2|tuic|snell|socks5?|http):\/\//i.test(value)) return parseUrlNode(value);
  throw new Error("不支持的分享链接协议");
}

function maybeDecodeSubscription(source: string) {
  if (/\w+:\/\//.test(source)) return source;
  try {
    const decoded = decodeBase64(source.replace(/\s/g, ""));
    return /\w+:\/\//.test(decoded) ? decoded : source;
  } catch { return source; }
}

export function parseShareLinks(source: string): LinkParseResult {
  const decoded = maybeDecodeSubscription(source);
  const lines = decoded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const nodes: ProxyNode[] = [];
  const errors: LinkParseError[] = [];
  lines.forEach((line, index) => {
    try { nodes.push(parseShareLink(line)); }
    catch (error) { errors.push({ line: index + 1, input: line.slice(0, 120), message: error instanceof Error ? error.message : "解析失败" }); }
  });
  return { nodes, errors };
}
