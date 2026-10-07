import { createEmptyConfig, type MihomoConfig, type ProxyNode } from "./types";
import { applyRuleTemplate } from "./ruleTemplates";

export type QuickPublishInput = { nodeIds: string[]; preset: "balanced" | "simple" | "current"; autoUpdate: boolean; includeNewNodes: boolean; updatedAt: string; previewRevision?: string; name?: string };
export type QuickPublishPreview = {
  revision: string;
  existingName?: string;
  existingVersion?: number;
  createsNewLink: boolean;
  contentChanged: boolean;
  before: { nodes: number; groups: number; rules: number } | null;
  after: { nodes: number; groups: number; rules: number };
};

export function recommendedConfig(nodes: ProxyNode[], preset: "balanced" | "simple") {
  const config = createEmptyConfig();
  const used = new Set<string>(["DIRECT", "REJECT", "节点选择"]);
  config.proxies = nodes.map((node) => {
    let name = node.name;
    let suffix = 2;
    while (used.has(name)) name = `${node.name} ${suffix++}`;
    used.add(name);
    return { ...node, name };
  });
  config.proxyGroups[0].proxies = config.proxies.map((node) => node.name);
  return preset === "balanced" ? applyRuleTemplate(config, "balanced", "节点选择", "replace") : config;
}

export function refreshProfileConfig(base: MihomoConfig, nodes: ProxyNode[], includeNew: boolean): MihomoConfig {
  const available = new Map(nodes.map((node) => [node.id, node]));
  const usedNames = new Set(["DIRECT", "REJECT", ...base.proxyGroups.map((group) => group.name)]);
  const rename = new Map<string, string>();
  const proxies: ProxyNode[] = [];
  const add = (node: ProxyNode, alias: string) => {
    let name = alias;
    let suffix = 2;
    while (usedNames.has(name)) name = `${alias} ${suffix++}`;
    usedNames.add(name);
    proxies.push({ ...node, name });
    return name;
  };
  for (const previous of base.proxies) {
    const node = available.get(previous.id);
    if (node) rename.set(previous.name, add(node, previous.name));
    available.delete(previous.id);
  }
  const additions = includeNew ? [...available.values()].map((node) => add(node, node.name)) : [];
  const oldNames = new Set(base.proxies.map((node) => node.name));
  const groups = base.proxyGroups.map((group) => ({ ...group, proxies: group.proxies.filter((member) => !oldNames.has(member) || rename.has(member)).map((member) => rename.get(member) || member) }));
  if (additions.length && !groups.length) throw new Error("没有可接收新增节点的代理组");
  if (groups.length) groups[0].proxies = [...new Set([...groups[0].proxies, ...additions])];
  return { ...base, proxies, proxyGroups: groups, rules: base.rules.map((rule) => ({ ...rule, target: rename.get(rule.target) || rule.target })) };
}
