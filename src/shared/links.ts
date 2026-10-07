import type { ProxyNode } from "./types";
import { createId } from "./id";

export interface LinkParseError { line: number; input: string; message: string }
export interface LinkParseResult { nodes: ProxyNode[]; errors: LinkParseError[] }

function decodeBase64(value: string): string {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeName(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch { return value; }
}

function hostPort(value: string): { server: string; port: number } {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0 || value[end + 1] !== ":") throw new Error("链接缺少有效端口");
    const port = Number(value.slice(end + 2));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("链接端口无效");
    return { server: value.slice(1, end), port };
  }
  const index = value.lastIndexOf(":");
  const port = Number(value.slice(index + 1));
  if (index < 1 || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("链接缺少有效服务器或端口");
  return { server: value.slice(0, index), port };
}

function common(name: string, type: string, server: string, port: number): ProxyNode {
  return { id: createId(), name, type, server, port, udp: true, extra: {} };
}

function parseSs(input: string): ProxyNode {
  const withoutScheme = input.slice(5);
  const [beforeFragment, fragment] = withoutScheme.split("#", 2);
  const [rawCore, query = ""] = beforeFragment.split("?", 2);
  const core = rawCore.replace(/\/$/, "");
  const params = new URLSearchParams(query);
  if (!core.includes("@")) {
    const decoded = decodeBase64(core);
    const at = decoded.lastIndexOf("@");
    if (at < 0) throw new Error("SS 链接缺少服务器信息");
    const credentials = decoded.slice(0, at);
    const address = hostPort(decoded.slice(at + 1));
    const separator = credentials.indexOf(":");
    if (separator <= 0 || separator === credentials.length - 1) throw new Error("SS 链接缺少加密方式或密码");
    const node = common(decodeName(fragment, address.server), "ss", address.server, address.port);
    node.cipher = credentials.slice(0, separator);
    node.password = credentials.slice(separator + 1);
    if (params.get("plugin")) node.extra.plugin = params.get("plugin");
    return node;
  }
  const at = core.lastIndexOf("@");
  let credentials = core.slice(0, at);
  try { credentials = decodeBase64(credentials); } catch { credentials = decodeURIComponent(credentials); }
  if (!credentials.includes(":")) credentials = decodeURIComponent(core.slice(0, at));
  const address = hostPort(core.slice(at + 1));
  const separator = credentials.indexOf(":");
  if (separator <= 0 || separator === credentials.length - 1) throw new Error("SS 链接缺少加密方式或密码");
  const node = common(decodeName(fragment, address.server), "ss", address.server, address.port);
  node.cipher = credentials.slice(0, separator);
  node.password = credentials.slice(separator + 1);
  if (params.get("plugin")) node.extra.plugin = params.get("plugin");
  return node;
}

function parseVmess(input: string): ProxyNode {
  const payload = JSON.parse(decodeBase64(input.slice("vmess://".length))) as Record<string, unknown>;
  const server = String(payload.add || "");
  const port = Number(payload.port || 443);
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("VMess 服务器或端口无效");
  const node = common(String(payload.ps || server || "VMess"), "vmess", server, port);
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
  const port = Number(fields[1]);
  if (!fields[0] || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSR 服务器或端口无效");
  const params = new URLSearchParams(query);
  const server = fields[0];
  const node = common(params.get("remarks") ? decodeBase64(params.get("remarks")!) : server, "ssr", server, port);
  node.cipher = fields[3];
  const obfsParamField = fields.length >= 7 ? fields[5] : "";
  const passwordField = fields.length >= 7 ? fields[6] : fields[5];
  node.password = decodeBase64(passwordField || "");
  node.extra = { protocol: fields[2], obfs: fields[4] };
  if (obfsParamField) node.extra["obfs-param"] = decodeBase64(obfsParamField);
  const protocolParam = params.get("protoparam");
  const obfsParam = params.get("obfsparam");
  if (protocolParam) node.extra["protocol-param"] = decodeBase64(protocolParam);
  if (obfsParam) node.extra["obfs-param"] = decodeBase64(obfsParam);
  return node;
}

function parseUrlNode(input: string): ProxyNode {
  const url = new URL(input);
  const typeMap: Record<string, string> = { "socks": "socks5", "socks5": "socks5", "hy2": "hysteria2", "hysteria": "hysteria2" };
  const type = typeMap[url.protocol.slice(0, -1).toLowerCase()] || url.protocol.slice(0, -1).toLowerCase();
  const server = url.hostname.replace(/^\[|\]$/g, "");
  const defaultPorts: Record<string, number> = { vless: 443, vmess: 443, trojan: 443, hysteria2: 443, tuic: 443, snell: 443, socks5: 1080, http: 80 };
  const port = Number(url.port || defaultPorts[type] || (url.searchParams.get("tls") ? 443 : 80));
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("分享链接服务器或端口无效");
  const node = common(decodeName(url.hash.slice(1), server), type, server, port);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (type === "vless" || type === "vmess") node.uuid = username;
  else if (type === "tuic") { node.uuid = username; node.password = password; }
  else if (type === "socks5" || type === "http") { node.password = password; if (username) node.extra.username = username; }
  else node.password = username || password;
  const security = url.searchParams.get("security") || "";
  node.tls = ["tls", "reality"].includes(security) || url.searchParams.get("tls") === "1";
  node.sni = url.searchParams.get("sni") || url.searchParams.get("peer") || undefined;
  node.skipCertVerify = url.searchParams.get("allowInsecure") === "1" || url.searchParams.get("insecure") === "1";
  node.network = url.searchParams.get("type") || url.searchParams.get("network") || undefined;
  node.wsPath = url.searchParams.get("path") || undefined;
  node.wsHost = url.searchParams.get("host") || undefined;
  node.grpcServiceName = url.searchParams.get("serviceName") || undefined;
  const fingerprint = url.searchParams.get("fp") || url.searchParams.get("fingerprint");
  const publicKey = url.searchParams.get("pbk") || url.searchParams.get("publicKey");
  const shortId = url.searchParams.get("sid") || url.searchParams.get("shortId");
  if (fingerprint) node.extra["client-fingerprint"] = fingerprint;
  if (security === "reality" && (publicKey || shortId)) node.extra["reality-opts"] = { ...(publicKey ? { "public-key": publicKey } : {}), ...(shortId ? { "short-id": shortId } : {}) };
  const alpn = url.searchParams.get("alpn");
  if (alpn) node.extra.alpn = alpn.split(",").map((item) => item.trim()).filter(Boolean);
  for (const [key, value] of url.searchParams) {
    if (!["security", "tls", "sni", "peer", "allowInsecure", "insecure", "type", "network", "path", "host", "serviceName", "fp", "fingerprint", "pbk", "publicKey", "sid", "shortId", "alpn"].includes(key)) node.extra[key] = value;
  }
  return node;
}

export function parseShareLink(input: string): ProxyNode {
  const value = input.trim();
  const scheme = value.slice(0, value.indexOf("://") + 3).toLowerCase();
  if (scheme === "ss://") return parseSs(value);
  if (scheme === "ssr://") return parseSsr(value);
  if (scheme === "vmess://") return parseVmess(value);
  if (/^(vless|trojan|hysteria|hysteria2|hy2|tuic|snell|socks5?|http):\/\//i.test(value)) return parseUrlNode(value);
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

function addressOf(node: ProxyNode) {
  const server = node.server.includes(":") && !node.server.startsWith("[") ? `[${node.server}]` : node.server;
  return `${server}:${node.port}`;
}

function fragmentOf(name: string) {
  return name ? `#${encodeURIComponent(name)}` : "";
}

function addCommonParams(node: ProxyNode, params: URLSearchParams) {
  if (node.tls) params.set("security", node.extra.security === "reality" || node.extra["reality-opts"] ? "reality" : "tls");
  if (node.sni) params.set("sni", node.sni);
  if (node.skipCertVerify) params.set("allowInsecure", "1");
  if (node.network) params.set("type", node.network);
  if (node.wsPath) params.set("path", node.wsPath);
  if (node.wsHost) params.set("host", node.wsHost);
  if (node.grpcServiceName) params.set("serviceName", node.grpcServiceName);
  const fingerprint = node.extra["client-fingerprint"] || node.extra.fingerprint;
  if (typeof fingerprint === "string" && fingerprint) params.set("fp", fingerprint);
  const flow = node.extra.flow;
  if (typeof flow === "string" && flow) params.set("flow", flow);
  const alpn = node.extra.alpn;
  if (Array.isArray(alpn) && alpn.length) params.set("alpn", alpn.map(String).join(","));
  const reality = node.extra["reality-opts"];
  if (reality && typeof reality === "object" && !Array.isArray(reality)) {
    const values = reality as Record<string, unknown>;
    if (typeof values["public-key"] === "string") params.set("pbk", values["public-key"]);
    if (typeof values["short-id"] === "string") params.set("sid", values["short-id"]);
  }
}

export function serializeShareLink(node: ProxyNode): string | null {
  const address = addressOf(node);
  const name = fragmentOf(node.name);
  const type = node.type.toLowerCase();
  if (type === "vmess") {
    const payload = {
      v: "2",
      ps: node.name,
      add: node.server,
      port: String(node.port),
      id: node.uuid || "",
      aid: "0",
      scy: node.cipher || "auto",
      net: node.network || "tcp",
      type: "none",
      host: node.wsHost || "",
      path: node.wsPath || node.grpcServiceName || "",
      tls: node.tls ? "tls" : "",
      sni: node.sni || "",
    };
    return `vmess://${encodeBase64(JSON.stringify(payload))}`;
  }
  if (type === "ss") {
    if (!node.cipher || node.password === undefined) return null;
    const plugin = typeof node.extra.plugin === "string" ? `?${new URLSearchParams({ plugin: node.extra.plugin })}` : "";
    return `ss://${encodeBase64(`${node.cipher}:${node.password}`)}@${address}${plugin}${name}`;
  }
  if (type === "ssr") {
    if (!node.cipher || !node.password || node.server.includes(":")) return null;
    const protocol = String(node.extra.protocol || "origin");
    const obfs = String(node.extra.obfs || "plain");
    const obfsParam = typeof node.extra["obfs-param"] === "string" ? encodeBase64(node.extra["obfs-param"] as string) : "";
    const password = encodeBase64(node.password || "");
    const query = new URLSearchParams({ remarks: encodeBase64(node.name), protoparam: typeof node.extra["protocol-param"] === "string" ? encodeBase64(node.extra["protocol-param"] as string) : "", obfsparam: obfsParam });
    const decoded = `${node.server}:${node.port}:${protocol}:${node.cipher}:${obfs}:${obfsParam}:${password}/?${query}`;
    return `ssr://${encodeBase64(decoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  }
  if (["vless", "trojan", "hysteria2", "snell"].includes(type)) {
    const params = new URLSearchParams();
    addCommonParams(node, params);
    const user = encodeURIComponent(type === "vless" ? node.uuid || "" : node.password || "");
    return `${type}://${user}@${address}${params.toString() ? `?${params}` : ""}${name}`;
  }
  if (type === "tuic") {
    const params = new URLSearchParams();
    addCommonParams(node, params);
    return `tuic://${encodeURIComponent(node.uuid || "")}:${encodeURIComponent(node.password || "")}@${address}${params.toString() ? `?${params}` : ""}${name}`;
  }
  if (type === "socks5" || type === "http") {
    const username = typeof node.extra.username === "string" ? node.extra.username : "";
    const credentials = username || node.password ? `${encodeURIComponent(username)}:${encodeURIComponent(node.password || "")}@` : "";
    return `${type}://${credentials}${address}${name}`;
  }
  return null;
}
