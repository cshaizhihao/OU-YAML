import type { MihomoConfig, ProxyGroup, ProxyNode, RuleItem } from "./types";
import { createId } from "./id";

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const without = (source: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback: number) => typeof value === "number" ? value : fallback;

function durationSeconds(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const multiplier = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 }[String(match[2] || "s").toLowerCase() as "ms" | "s" | "m" | "h" | "d"];
  return Math.round(amount * multiplier);
}

function parseOutbound(value: unknown): ProxyNode | ProxyGroup | null {
  const outbound = asObject(value);
  const type = text(outbound.type);
  const tag = text(outbound.tag, "未命名出站");
  if (["direct", "block", "dns"].includes(type)) return null;
  if (type === "selector" || type === "urltest") {
    return {
      id: createId(), name: tag, type: type === "selector" ? "select" : "url-test",
      proxies: Array.isArray(outbound.outbounds) ? outbound.outbounds.map(String) : [],
      url: text(outbound.url) || undefined,
      interval: durationSeconds(outbound.interval) || undefined,
      tolerance: number(outbound.tolerance, 0) || undefined,
      lazy: typeof outbound.idle_timeout === "string" ? true : undefined,
      extra: {}, formatExtra: { singBox: without(outbound, ["type", "tag", "outbounds", "url", "interval", "tolerance", "idle_timeout"]) },
    };
  }
  const tls = asObject(outbound.tls);
  const transport = asObject(outbound.transport);
  const headers = asObject(transport.headers);
  const typeMap: Record<string, string> = { shadowsocks: "ss", socks: "socks5", hysteria2: "hysteria2" };
  const node: ProxyNode = {
    id: createId(), name: tag, type: typeMap[type] || type,
    server: text(outbound.server), port: number(outbound.server_port, 443),
    udp: true, tls: tls.enabled === true, skipCertVerify: tls.insecure === true,
    sni: text(tls.server_name) || undefined, uuid: text(outbound.uuid) || undefined,
    password: text(outbound.password) || undefined, cipher: text(outbound.method) || undefined,
    network: text(transport.type) || undefined, wsPath: text(transport.path) || undefined,
    wsHost: text(headers.Host ?? headers.host) || undefined,
    grpcServiceName: text(transport.service_name) || undefined,
    extra: {}, formatExtra: { singBox: { ...without(outbound, ["type", "tag", "server", "server_port", "uuid", "password", "method", "tls", "transport"]), ...(Object.keys(tls).length ? { tls: without(tls, ["enabled", "server_name", "insecure"]) } : {}), ...(Object.keys(transport).length ? { transport } : {}) } },
  };
  return node;
}

function parseRouteRules(value: unknown): { rules: RuleItem[]; unsupported: unknown[]; order: { kind: "rule" | "unsupported" }[] } {
  const input = Array.isArray(value) ? value : [];
  const rules: RuleItem[] = [];
  const unsupported: unknown[] = [];
  const order: { kind: "rule" | "unsupported" }[] = [];
  const mappings: [string, string][] = [["domain_suffix", "DOMAIN-SUFFIX"], ["domain_keyword", "DOMAIN-KEYWORD"], ["domain", "DOMAIN"], ["ip_cidr", "IP-CIDR"], ["geoip", "GEOIP"], ["geosite", "GEOSITE"], ["process_name", "PROCESS-NAME"], ["rule_set", "RULE-SET"]];
  for (const raw of input) {
    const rule = asObject(raw);
    const action = text(rule.action);
    const target = text(rule.outbound, action === "reject" ? "REJECT" : "");
    const candidates = mappings.filter(([key]) => rule[key] !== undefined);
    const mapping = candidates[0];
    const rawValues = mapping ? rule[mapping[0]] : undefined;
    if (!mapping || !target || candidates.length !== 1 || !((Array.isArray(rawValues) && rawValues.length === 1) || (!Array.isArray(rawValues) && rawValues !== undefined))) { unsupported.push(raw); order.push({ kind: "unsupported" }); continue; }
    const values = [rawValues];
    for (const value of values) rules.push({ id: createId(), type: mapping[1], value: String(value), target, options: [], enabled: true });
    order.push({ kind: "rule" });
  }
  return { rules, unsupported, order };
}

export function parseSingBoxJson(source: string): MihomoConfig {
  const root = asObject(JSON.parse(source));
  const outbounds = Array.isArray(root.outbounds) ? root.outbounds : [];
  const builtinTags = new Map<string, string>();
  for (const value of outbounds) {
    const outbound = asObject(value);
    if (outbound.type === "direct") builtinTags.set(text(outbound.tag, "direct"), "DIRECT");
    if (outbound.type === "block") builtinTags.set(text(outbound.tag, "block"), "REJECT");
  }
  const parsed = outbounds.map(parseOutbound);
  const proxies = parsed.filter((item): item is ProxyNode => !!item && "server" in item);
  const proxyGroups = parsed.filter((item): item is ProxyGroup => !!item && "proxies" in item);
  for (const group of proxyGroups) group.proxies = group.proxies.map((member) => builtinTags.get(member) || member);
  const route = asObject(root.route);
  const routeResult = parseRouteRules(route.rules);
  for (const rule of routeResult.rules) rule.target = builtinTags.get(rule.target) || rule.target;
  const final = text(route.final);
  if (final) routeResult.rules.push({ id: createId(), type: "MATCH", value: "", target: builtinTags.get(final) || final, options: [], enabled: true });
  const inbounds = Array.isArray(root.inbounds) ? root.inbounds : [];
  const mixed = inbounds.map(asObject).find((item) => item.type === "mixed");
  const log = asObject(root.log);
  return {
    version: 1,
    mixedPort: number(mixed?.listen_port, 7890), allowLan: mixed?.listen === "0.0.0.0", mode: "rule",
    logLevel: (text(log.level, "info") as MihomoConfig["logLevel"]), ipv6: true, externalController: "127.0.0.1:9090",
    proxies, proxyGroups, rules: routeResult.rules, extra: {},
    metadata: { singBox: {
      topLevel: without(root, ["log", "inbounds", "outbounds", "route"]),
      logExtra: without(log, ["level"]), inbounds,
      routeExtra: without(route, ["rules", "final"]), unsupportedRules: routeResult.unsupported, routeOrder: routeResult.order,
      unsupportedOutbounds: outbounds.filter((item, index) => !parsed[index] && !["direct", "block"].includes(text(asObject(item).type))),
    } },
  };
}

function exportNode(node: ProxyNode) {
  const typeMap: Record<string, string> = { ss: "shadowsocks", socks5: "socks" };
  const singBoxExtra = asObject(node.formatExtra?.singBox);
  const originalTls = asObject(singBoxExtra.tls);
  const originalTransport = asObject(singBoxExtra.transport);
  const { tls: _tls, transport: _transport, ...outboundExtra } = singBoxExtra;
  const transport = node.network && node.network !== "tcp" ? {
    ...originalTransport,
    type: node.network,
    ...(node.network === "ws" ? { path: node.wsPath, headers: node.wsHost ? { ...asObject(originalTransport.headers), Host: node.wsHost } : originalTransport.headers } : {}),
    ...(node.network === "grpc" ? { service_name: node.grpcServiceName } : {}),
  } : Object.keys(originalTransport).length ? originalTransport : undefined;
  const tls = node.tls || Object.keys(originalTls).length ? { ...originalTls, enabled: node.tls === undefined ? true : node.tls, ...(node.sni ? { server_name: node.sni } : {}), ...(node.skipCertVerify !== undefined ? { insecure: node.skipCertVerify } : {}) } : undefined;
  return {
    ...outboundExtra,
    type: typeMap[node.type] || node.type, tag: node.name, server: node.server, server_port: node.port,
    ...(node.uuid ? { uuid: node.uuid } : {}), ...(node.password ? { password: node.password } : {}),
    ...(node.cipher ? { method: node.cipher } : {}),
    ...(tls ? { tls } : {}),
    ...(transport ? { transport } : {}),
  };
}

function exportGroup(group: ProxyGroup) {
  return {
    ...group.formatExtra?.singBox,
    type: group.type === "url-test" ? "urltest" : "selector", tag: group.name, outbounds: group.proxies,
    ...(group.type === "url-test" ? { url: group.url, interval: `${group.interval || 300}s`, tolerance: group.tolerance } : {}),
  };
}

export function singBoxCompatibility(config: MihomoConfig): string[] {
  const errors: string[] = [];
  for (const group of config.proxyGroups) {
    if (!["select", "url-test"].includes(group.type)) errors.push(`代理组“${group.name}”的 ${group.type} 无法等价转换为 sing-box，请使用 Mihomo 或调整分组`);
    if (group.proxies.includes("REJECT")) errors.push(`代理组“${group.name}”引用了 REJECT，请改用拒绝规则`);
  }
  for (const rule of config.rules.filter((item) => item.enabled)) {
    if (!["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6", "PROCESS-NAME", "RULE-SET", "MATCH"].includes(rule.type)) errors.push(`规则 ${rule.type} 无法导出到当前 sing-box，请使用 Mihomo 或改用规则集`);
    if (rule.type === "MATCH" && rule.target === "REJECT") errors.push("sing-box 最终出口不能使用 REJECT");
    if (rule.options.length) errors.push(`规则 ${rule.type} 的附加参数无法无损转换，请使用 Mihomo`);
  }
  for (const node of config.proxies) {
    if (!["ss", "vmess", "vless", "trojan", "socks5", "http", "hysteria2", "tuic"].includes(node.type)) errors.push(`节点“${node.name}”的协议 ${node.type} 暂不支持跨格式导出`);
    if (Object.keys(node.extra).length && !node.formatExtra?.singBox) errors.push(`节点“${node.name}”包含 Mihomo 专属参数，请保留 Mihomo 格式`);
  }
  return [...new Set(errors)];
}

function exportRule(rule: RuleItem) {
  const mappings: Record<string, string> = { DOMAIN: "domain", "DOMAIN-SUFFIX": "domain_suffix", "DOMAIN-KEYWORD": "domain_keyword", "IP-CIDR": "ip_cidr", "IP-CIDR6": "ip_cidr", GEOIP: "geoip", GEOSITE: "geosite", "PROCESS-NAME": "process_name", "RULE-SET": "rule_set" };
  const key = mappings[rule.type];
  return key ? { [key]: [rule.value], ...(rule.target === "REJECT" ? { action: "reject" } : { outbound: rule.target }) } : null;
}

export function exportSingBoxJson(config: MihomoConfig): string {
  const errors = singBoxCompatibility(config);
  if (errors.length) throw new Error(errors.join("；"));
  const metadata = asObject(config.metadata?.singBox);
  const topLevel = asObject(metadata.topLevel);
  const originalInbounds = Array.isArray(metadata.inbounds) ? metadata.inbounds.map(asObject) : [];
  let replacedMixed = false;
  const inbounds = originalInbounds.map((inbound) => {
    if (inbound.type !== "mixed" || replacedMixed) return inbound;
    replacedMixed = true;
    return { ...inbound, type: "mixed", tag: text(inbound.tag, "mixed-in"), listen: config.allowLan ? "0.0.0.0" : "127.0.0.1", listen_port: config.mixedPort };
  });
  if (!replacedMixed) inbounds.unshift({ type: "mixed", tag: "mixed-in", listen: config.allowLan ? "0.0.0.0" : "127.0.0.1", listen_port: config.mixedPort });
  const unsupportedOutbounds = Array.isArray(metadata.unsupportedOutbounds) ? metadata.unsupportedOutbounds : [];
  const unsupportedRules = Array.isArray(metadata.unsupportedRules) ? metadata.unsupportedRules : [];
  const supportedRules = config.rules.filter((rule) => rule.enabled && rule.type !== "MATCH").map(exportRule).filter(Boolean);
  const final = config.rules.find((rule) => rule.enabled && rule.type === "MATCH")?.target;
  const routeOrder = Array.isArray(metadata.routeOrder) ? metadata.routeOrder : [];
  const orderedRules: unknown[] = [];
  let supportedIndex = 0;
  let unsupportedIndex = 0;
  for (const item of routeOrder) {
    const kind = asObject(item).kind;
    if (kind === "rule" && supportedIndex < supportedRules.length) orderedRules.push(supportedRules[supportedIndex++]);
    else if (kind === "unsupported" && unsupportedIndex < unsupportedRules.length) orderedRules.push(unsupportedRules[unsupportedIndex++]);
  }
  orderedRules.push(...supportedRules.slice(supportedIndex), ...unsupportedRules.slice(unsupportedIndex));
  const output = {
    ...topLevel,
    log: { ...asObject(metadata.logExtra), level: config.logLevel },
    inbounds,
    outbounds: [...config.proxies.map(exportNode), ...config.proxyGroups.map(exportGroup), ...unsupportedOutbounds, { type: "direct", tag: "DIRECT" }],
    route: { ...asObject(metadata.routeExtra), rules: orderedRules, ...(final ? { final } : {}) },
  };
  return JSON.stringify(output, null, 2) + "\n";
}
