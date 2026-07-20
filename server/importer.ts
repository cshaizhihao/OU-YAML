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
  const starterGroup = config.proxies.length === 0 && config.proxyGroups.length === 1 && config.proxyGroups[0].name === "节点选择";
  const proxyGroups = config.proxyGroups.map((group, index) => {
    const referencedPrevious = group.proxies.some((member) => previousNames.has(member));
    if (!referencedPrevious && !(starterGroup && index === 0)) return group;
    const retainedMembers = group.proxies.filter((member) => !previousNames.has(member));
    return { ...group, proxies: [...new Set([...nodes.map((node) => node.name), ...retainedMembers])] };
  });
  return { ...config, proxies: [...retained, ...nodes], proxyGroups };
}
