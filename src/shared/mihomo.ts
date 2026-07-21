import YAML from "yaml";
import type { MihomoConfig, ProxyGroup, ProxyNode, RuleItem, ValidationIssue } from "./types";
import { createId } from "./id";

const TOP_LEVEL_KEYS = new Set(["mixed-port", "allow-lan", "mode", "log-level", "ipv6", "external-controller", "proxies", "proxy-groups", "rules"]);
const PROXY_KEYS = new Set(["name", "type", "server", "port", "udp", "tls", "skip-cert-verify", "servername", "sni", "uuid", "password", "cipher", "network", "ws-opts", "grpc-opts"]);
const GROUP_KEYS = new Set(["name", "type", "proxies", "url", "interval", "tolerance", "lazy"]);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rest(source: Record<string, unknown>, keys: Set<string>) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.has(key)));
}

function readString(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function readNumber(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function readBoolean(value: unknown, fallback = false) { return typeof value === "boolean" ? value : fallback; }

function parseProxy(value: unknown): ProxyNode {
  const item = objectValue(value);
  const ws = objectValue(item["ws-opts"]);
  const headers = objectValue(ws.headers);
  const grpc = objectValue(item["grpc-opts"]);
  const extra = rest(item, PROXY_KEYS);
  if (item["ws-opts"]) extra["ws-opts"] = item["ws-opts"];
  if (item["grpc-opts"]) extra["grpc-opts"] = item["grpc-opts"];
  return {
    id: createId(),
    name: readString(item.name, "未命名节点"),
    type: readString(item.type, "ss"),
    server: readString(item.server),
    port: readNumber(item.port, 443),
    udp: typeof item.udp === "boolean" ? item.udp : undefined,
    tls: typeof item.tls === "boolean" ? item.tls : undefined,
    skipCertVerify: typeof item["skip-cert-verify"] === "boolean" ? item["skip-cert-verify"] : undefined,
    sni: readString(item.servername ?? item.sni) || undefined,
    uuid: readString(item.uuid) || undefined,
    password: readString(item.password) || undefined,
    cipher: readString(item.cipher) || undefined,
    network: readString(item.network) || undefined,
    wsPath: readString(ws.path) || undefined,
    wsHost: readString(headers.Host ?? headers.host) || undefined,
    grpcServiceName: readString(grpc["grpc-service-name"]) || undefined,
    extra,
  };
}

function parseGroup(value: unknown): ProxyGroup {
  const item = objectValue(value);
  return {
    id: createId(),
    name: readString(item.name, "未命名策略组"),
    type: readString(item.type, "select") as ProxyGroup["type"],
    proxies: Array.isArray(item.proxies) ? item.proxies.map((entry) => String(entry)) : [],
    url: readString(item.url) || undefined,
    interval: typeof item.interval === "number" ? item.interval : undefined,
    tolerance: typeof item.tolerance === "number" ? item.tolerance : undefined,
    lazy: typeof item.lazy === "boolean" ? item.lazy : undefined,
    extra: rest(item, GROUP_KEYS),
  };
}

export function parseRule(rawValue: unknown): RuleItem {
  const raw = String(rawValue).trim();
  const enabled = !raw.startsWith("#");
  const line = enabled ? raw : raw.replace(/^#\s?/, "");
  const parts = line.split(",").map((part) => part.trim());
  const type = parts.shift()?.toUpperCase() || "MATCH";
  if (type === "MATCH") {
    return { id: createId(), type, value: "", target: parts.shift() || "DIRECT", options: parts, enabled };
  }
  const value = parts.shift() || "";
  const target = parts.shift() || "DIRECT";
  return { id: createId(), type, value, target, options: parts, enabled };
}

export function parseMihomoYaml(source: string): MihomoConfig {
  const document = YAML.parseDocument(source, { prettyErrors: true });
  if (document.errors.length) throw new Error(document.errors[0].message);
  const root = objectValue(document.toJS({ maxAliasCount: 50 }));
  return {
    version: 1,
    mixedPort: readNumber(root["mixed-port"], 7890),
    allowLan: readBoolean(root["allow-lan"]),
    mode: readString(root.mode, "rule") as MihomoConfig["mode"],
    logLevel: readString(root["log-level"], "info") as MihomoConfig["logLevel"],
    ipv6: readBoolean(root.ipv6),
    externalController: readString(root["external-controller"], "127.0.0.1:9090"),
    proxies: Array.isArray(root.proxies) ? root.proxies.map(parseProxy) : [],
    proxyGroups: Array.isArray(root["proxy-groups"]) ? root["proxy-groups"].map(parseGroup) : [],
    rules: Array.isArray(root.rules) ? root.rules.map(parseRule) : [],
    extra: rest(root, TOP_LEVEL_KEYS),
  };
}

function cleanUndefined(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== ""));
}

function exportProxy(node: ProxyNode) {
  const originalWs = objectValue(node.extra["ws-opts"]);
  const originalHeaders = objectValue(originalWs.headers);
  const originalGrpc = objectValue(node.extra["grpc-opts"]);
  const wsOpts = node.network === "ws" && (node.wsPath || node.wsHost) ? cleanUndefined({
    ...originalWs,
    path: node.wsPath,
    headers: node.wsHost ? { ...originalHeaders, Host: node.wsHost } : originalWs.headers,
  }) : undefined;
  const grpcOpts = node.network === "grpc" && node.grpcServiceName ? { ...originalGrpc, "grpc-service-name": node.grpcServiceName } : undefined;
  return cleanUndefined({
    ...node.extra,
    name: node.name,
    type: node.type,
    server: node.server,
    port: node.port,
    udp: node.udp,
    tls: node.tls,
    "skip-cert-verify": node.skipCertVerify,
    servername: node.sni,
    uuid: node.uuid,
    password: node.password,
    cipher: node.cipher,
    network: node.network,
    "ws-opts": wsOpts,
    "grpc-opts": grpcOpts,
  });
}

function exportRule(rule: RuleItem) {
  const fields = rule.type === "MATCH"
    ? [rule.type, rule.target, ...rule.options]
    : [rule.type, rule.value, rule.target, ...rule.options];
  return `${rule.enabled ? "" : "# "}${fields.filter(Boolean).join(",")}`;
}

export function exportMihomoYaml(config: MihomoConfig): string {
  const output = {
    ...config.extra,
    "mixed-port": config.mixedPort,
    "allow-lan": config.allowLan,
    mode: config.mode,
    "log-level": config.logLevel,
    ipv6: config.ipv6,
    "external-controller": config.externalController,
    proxies: config.proxies.map(exportProxy),
    "proxy-groups": config.proxyGroups.map((group) => cleanUndefined({
      ...group.extra,
      name: group.name,
      type: group.type,
      proxies: group.proxies,
      url: group.url,
      interval: group.interval,
      tolerance: group.tolerance,
      lazy: group.lazy,
    })),
    rules: config.rules.filter((rule) => rule.enabled).map(exportRule),
  };
  return YAML.stringify(output, { lineWidth: 0, indent: 2 });
}

export function validateConfig(config: MihomoConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const duplicates = (values: string[]) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
  for (const name of duplicates(config.proxies.map((proxy) => proxy.name))) issues.push({ level: "error", scope: "proxy", message: `节点名称重复：${name}` });
  for (const name of duplicates(config.proxyGroups.map((group) => group.name))) issues.push({ level: "error", scope: "group", message: `策略组名称重复：${name}` });

  for (const proxy of config.proxies) {
    if (!proxy.name.trim()) issues.push({ level: "error", scope: "proxy", id: proxy.id, message: "节点名称不能为空" });
    if (!proxy.server.trim()) issues.push({ level: "error", scope: "proxy", id: proxy.id, message: `${proxy.name || "节点"} 缺少服务器地址` });
    if (!Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65535) issues.push({ level: "error", scope: "proxy", id: proxy.id, message: `${proxy.name || "节点"} 的端口无效` });
  }

  const nodeNames = new Set(config.proxies.map((proxy) => proxy.name));
  const groupNames = new Set(config.proxyGroups.map((group) => group.name));
  const builtins = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "GLOBAL"]);
  for (const group of config.proxyGroups) {
    if (!group.name.trim()) issues.push({ level: "error", scope: "group", id: group.id, message: "策略组名称不能为空" });
    if (!group.proxies.length) issues.push({ level: "warning", scope: "group", id: group.id, message: `${group.name} 没有任何成员` });
    for (const member of group.proxies) {
      if (!nodeNames.has(member) && !groupNames.has(member) && !builtins.has(member)) issues.push({ level: "error", scope: "group", id: group.id, message: `${group.name} 引用了不存在的成员：${member}` });
    }
  }

  const graph = new Map(config.proxyGroups.map((group) => [group.name, group.proxies.filter((member) => groupNames.has(member))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): boolean => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    const cycle = (graph.get(name) || []).some(visit);
    visiting.delete(name);
    visited.add(name);
    return cycle;
  };
  for (const group of config.proxyGroups) if (visit(group.name)) issues.push({ level: "error", scope: "group", id: group.id, message: `${group.name} 存在循环引用` });

  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    if (!rule.type.trim()) issues.push({ level: "error", scope: "rule", id: rule.id, message: "规则类型不能为空" });
    if (rule.type !== "MATCH" && !rule.value.trim()) issues.push({ level: "error", scope: "rule", id: rule.id, message: `${rule.type} 规则缺少匹配内容` });
    if (!groupNames.has(rule.target) && !builtins.has(rule.target)) issues.push({ level: "error", scope: "rule", id: rule.id, message: `规则引用了不存在的策略：${rule.target}` });
  }
  if (!config.rules.some((rule) => rule.enabled && rule.type === "MATCH")) issues.push({ level: "warning", scope: "config", message: "建议在规则末尾添加 MATCH 兜底规则" });
  return issues;
}
