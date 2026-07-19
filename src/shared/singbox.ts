import type { MihomoConfig, ProxyGroup, ProxyNode, RuleItem } from "./types";

const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const without = (source: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const number = (value: unknown, fallback: number) => typeof value === "number" ? value : fallback;

function parseOutbound(value: unknown): ProxyNode | ProxyGroup | null {
  const outbound = asObject(value);
  const type = text(outbound.type);
  const tag = text(outbound.tag, "未命名出站");
  if (["direct", "block", "dns"].includes(type)) return null;
  if (type === "selector" || type === "urltest") {
    return {
      id: crypto.randomUUID(), name: tag, type: type === "selector" ? "select" : "url-test",
      proxies: Array.isArray(outbound.outbounds) ? outbound.outbounds.map(String) : [],
      url: text(outbound.url) || undefined,
      interval: typeof outbound.interval === "string" ? Number.parseInt(outbound.interval, 10) : number(outbound.interval, 0) || undefined,
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
    id: crypto.randomUUID(), name: tag, type: typeMap[type] || type,
    server: text(outbound.server), port: number(outbound.server_port, 443),
    udp: true, tls: tls.enabled === true, skipCertVerify: tls.insecure === true,
    sni: text(tls.server_name) || undefined, uuid: text(outbound.uuid) || undefined,
    password: text(outbound.password) || undefined, cipher: text(outbound.method) || undefined,
    network: text(transport.type) || undefined, wsPath: text(transport.path) || undefined,
    wsHost: text(headers.Host ?? headers.host) || undefined,
    grpcServiceName: text(transport.service_name) || undefined,
    extra: {}, formatExtra: { singBox: without(outbound, ["type", "tag", "server", "server_port", "uuid", "password", "method", "tls", "transport"]) },
  };
  return node;
}

function parseRouteRules(value: unknown): { rules: RuleItem[]; unsupported: unknown[] } {
  const input = Array.isArray(value) ? value : [];
  const rules: RuleItem[] = [];
  const unsupported: unknown[] = [];
  const mappings: [string, string][] = [["domain_suffix", "DOMAIN-SUFFIX"], ["domain_keyword", "DOMAIN-KEYWORD"], ["domain", "DOMAIN"], ["ip_cidr", "IP-CIDR"], ["geoip", "GEOIP"], ["geosite", "GEOSITE"], ["process_name", "PROCESS-NAME"], ["rule_set", "RULE-SET"]];
  for (const raw of input) {
    const rule = asObject(raw);
    const target = text(rule.outbound, text(rule.action) === "reject" ? "REJECT" : "DIRECT");
    const mapping = mappings.find(([key]) => rule[key] !== undefined);
    if (!mapping) { unsupported.push(raw); continue; }
    const values = Array.isArray(rule[mapping[0]]) ? rule[mapping[0]] as unknown[] : [rule[mapping[0]]];
    for (const value of values) rules.push({ id: crypto.randomUUID(), type: mapping[1], value: String(value), target, options: [], enabled: true });
  }
  return { rules, unsupported };
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
  if (final) routeResult.rules.push({ id: crypto.randomUUID(), type: "MATCH", value: "", target: builtinTags.get(final) || final, options: [], enabled: true });
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
      routeExtra: without(route, ["rules", "final"]), unsupportedRules: routeResult.unsupported,
      unsupportedOutbounds: outbounds.filter((item) => text(asObject(item).type) === "dns"),
    } },
  };
}

function exportNode(node: ProxyNode) {
  const typeMap: Record<string, string> = { ss: "shadowsocks", socks5: "socks" };
  const transport = node.network && node.network !== "tcp" ? {
    type: node.network,
    ...(node.network === "ws" ? { path: node.wsPath, headers: node.wsHost ? { Host: node.wsHost } : undefined } : {}),
    ...(node.network === "grpc" ? { service_name: node.grpcServiceName } : {}),
  } : undefined;
  return {
    ...node.formatExtra?.singBox,
    type: typeMap[node.type] || node.type, tag: node.name, server: node.server, server_port: node.port,
    ...(node.uuid ? { uuid: node.uuid } : {}), ...(node.password ? { password: node.password } : {}),
    ...(node.cipher ? { method: node.cipher } : {}),
    ...(node.tls ? { tls: { enabled: true, server_name: node.sni, insecure: node.skipCertVerify || false } } : {}),
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

function exportRule(rule: RuleItem) {
  const mappings: Record<string, string> = { DOMAIN: "domain", "DOMAIN-SUFFIX": "domain_suffix", "DOMAIN-KEYWORD": "domain_keyword", "IP-CIDR": "ip_cidr", "IP-CIDR6": "ip_cidr", GEOIP: "geoip", GEOSITE: "geosite", "PROCESS-NAME": "process_name", "RULE-SET": "rule_set" };
  const key = mappings[rule.type];
  return key ? { [key]: [rule.value], outbound: rule.target } : null;
}

export function exportSingBoxJson(config: MihomoConfig): string {
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
  const output = {
    ...topLevel,
    log: { ...asObject(metadata.logExtra), level: config.logLevel },
    inbounds,
    outbounds: [...config.proxies.map(exportNode), ...config.proxyGroups.map(exportGroup), ...unsupportedOutbounds, { type: "direct", tag: "DIRECT" }, { type: "block", tag: "REJECT" }],
    route: { ...asObject(metadata.routeExtra), rules: [...supportedRules, ...unsupportedRules], ...(final ? { final } : {}) },
  };
  return JSON.stringify(output, null, 2) + "\n";
}
