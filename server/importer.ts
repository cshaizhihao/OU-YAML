import { parseShareLinks } from "../src/shared/links";
import { parseMihomoYaml } from "../src/shared/mihomo";
import { parseSingBoxJson } from "../src/shared/singbox";
import type { MihomoConfig, ProxyNode, TargetFormat } from "../src/shared/types";

export type ImportFormat = "auto" | "links" | "mihomo" | "sing-box";

export function parseImportedContent(content: string, format: ImportFormat = "auto"): { config?: MihomoConfig; nodes: ProxyNode[]; format: TargetFormat | "links"; warnings: string[] } {
  const trimmed = content.trim();
  const selected = format === "auto"
    ? (trimmed.startsWith("{") && /"outbounds"\s*:/.test(trimmed) ? "sing-box" : /(^|\n)\s*(proxies|proxy-groups|mixed-port)\s*:/.test(trimmed) ? "mihomo" : "links")
    : format;
  if (selected === "sing-box") {
    const config = parseSingBoxJson(trimmed);
    return { config, nodes: config.proxies, format: "sing-box", warnings: [] };
  }
  if (selected === "mihomo") {
    const config = parseMihomoYaml(trimmed);
    return { config, nodes: config.proxies, format: "mihomo", warnings: [] };
  }
  const result = parseShareLinks(trimmed);
  if (!result.nodes.length) throw new Error(result.errors[0]?.message || "没有识别到可导入的节点");
  return { nodes: result.nodes, format: "links", warnings: result.errors.map((error) => `第 ${error.line} 行：${error.message}`) };
}

function nodeIdentity(node: ProxyNode) {
  return [
    node.type,
    node.server,
    node.port,
    node.uuid || "",
    node.password || "",
    node.cipher || "",
    node.sni || "",
    node.network || "",
    node.wsPath || "",
    node.wsHost || "",
    node.grpcServiceName || "",
  ].join("\u001f").toLowerCase();
}

export function mergeSubscriptionNodes(config: MihomoConfig, subscriptionId: string, incoming: ProxyNode[]) {
  const previous = config.proxies.filter((node) => node.source?.id === subscriptionId);
  const previousNames = new Set(previous.map((node) => node.name));
  const retained = config.proxies.filter((node) => node.source?.id !== subscriptionId);
  const used = new Set(retained.map((node) => node.name));
  const nodes = incoming.map((node) => {
    const base = node.name.trim() || `${node.type.toUpperCase()} 节点`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    used.add(name);
    return { ...node, name, source: { kind: "subscription" as const, id: subscriptionId } };
  });

  const incomingByIdentity = new Map<string, number[]>();
  const incomingByName = new Map<string, number[]>();
  incoming.forEach((node, index) => {
    const identity = nodeIdentity(node);
    incomingByIdentity.set(identity, [...(incomingByIdentity.get(identity) || []), index]);
    const name = node.name.trim();
    if (name) incomingByName.set(name, [...(incomingByName.get(name) || []), index]);
  });
  const matchedIncoming = new Map<string, number>();
  const consumedIncoming = new Set<number>();
  const takeCandidate = (candidates: number[] | undefined) => {
    const index = candidates?.find((item) => !consumedIncoming.has(item));
    if (index === undefined) return undefined;
    consumedIncoming.add(index);
    return index;
  };
  for (const previousNode of previous) {
    const match = takeCandidate(incomingByIdentity.get(nodeIdentity(previousNode)))
      ?? takeCandidate(incomingByName.get(previousNode.name.trim()));
    if (match !== undefined) matchedIncoming.set(previousNode.name, match);
  }

  const ordered: ProxyNode[] = [];
  for (const node of config.proxies) {
    if (node.source?.id !== subscriptionId) {
      ordered.push(node);
      continue;
    }
    const match = matchedIncoming.get(node.name);
    if (match !== undefined) ordered.push(nodes[match]);
  }
  nodes.forEach((node, index) => {
    if (!consumedIncoming.has(index)) ordered.push(node);
  });

  const replacementNames = new Map<string, string>();
  matchedIncoming.forEach((index, oldName) => replacementNames.set(oldName, nodes[index].name));
  const starterGroup = config.proxies.length === 0 && config.proxyGroups.length === 1 && config.proxyGroups[0].name === "节点选择";
  const proxyGroups = config.proxyGroups.map((group, index) => {
    const referencedPrevious = group.proxies.some((member) => previousNames.has(member));
    if (starterGroup && index === 0) return { ...group, proxies: [...new Set([...nodes.map((node) => node.name), ...group.proxies])] };
    if (!referencedPrevious) return group;

    const members: string[] = [];
    let lastSourcePosition = -1;
    for (const member of group.proxies) {
      if (!previousNames.has(member)) {
        members.push(member);
        continue;
      }
      const replacement = replacementNames.get(member);
      if (replacement && !members.includes(replacement)) members.push(replacement);
      lastSourcePosition = members.length;
    }
    const additions = nodes.map((node) => node.name).filter((name) => !members.includes(name));
    const insertion = lastSourcePosition >= 0 ? lastSourcePosition : members.length;
    members.splice(insertion, 0, ...additions);
    return { ...group, proxies: [...new Set(members)] };
  });
  return { ...config, proxies: ordered, proxyGroups };
}
