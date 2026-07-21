import type { MihomoConfig, RuleItem } from "./types";
import { createId } from "./id";

interface TemplateRule { type: string; value: string; target: "DIRECT" | "REJECT" | "$TARGET"; options?: string[] }
export interface RuleTemplate { id: string; name: string; rules: TemplateRule[] }

const lanRules: TemplateRule[] = [
  ["IP-CIDR", "10.0.0.0/8"], ["IP-CIDR", "172.16.0.0/12"], ["IP-CIDR", "192.168.0.0/16"], ["IP-CIDR", "127.0.0.0/8"],
].map(([type, value]) => ({ type, value, target: "DIRECT", options: ["no-resolve"] }));

export const ruleTemplates: RuleTemplate[] = [
  { id: "lan-direct", name: "局域网直连", rules: [...lanRules, { type: "IP-CIDR6", value: "fc00::/7", target: "DIRECT", options: ["no-resolve"] }, { type: "IP-CIDR6", value: "fe80::/10", target: "DIRECT", options: ["no-resolve"] }] },
  { id: "ads-block", name: "广告拦截", rules: [{ type: "GEOSITE", value: "category-ads-all", target: "REJECT" }] },
  { id: "china-direct", name: "国内直连", rules: [{ type: "GEOSITE", value: "CN", target: "DIRECT" }, { type: "GEOIP", value: "CN", target: "DIRECT", options: ["no-resolve"] }] },
  { id: "developer", name: "开发服务", rules: [{ type: "DOMAIN-SUFFIX", value: "github.com", target: "$TARGET" }, { type: "DOMAIN-SUFFIX", value: "githubusercontent.com", target: "$TARGET" }, { type: "DOMAIN-SUFFIX", value: "npmjs.org", target: "$TARGET" }] },
  { id: "balanced", name: "基础分流", rules: [...lanRules, { type: "GEOSITE", value: "category-ads-all", target: "REJECT" }, { type: "GEOSITE", value: "CN", target: "DIRECT" }, { type: "GEOIP", value: "CN", target: "DIRECT", options: ["no-resolve"] }, { type: "MATCH", value: "", target: "$TARGET" }] },
];

export function applyRuleTemplate(config: MihomoConfig, templateId: string, target: string, mode: "append" | "replace") {
  const template = ruleTemplates.find((item) => item.id === templateId);
  if (!template) throw new Error("规则模板不存在");
  const generated: RuleItem[] = template.rules.map((rule) => ({
    id: createId(), type: rule.type, value: rule.value,
    target: rule.target === "$TARGET" ? target : rule.target,
    options: rule.options || [], enabled: true,
  }));
  if (mode === "replace" && !generated.some((rule) => rule.type === "MATCH")) {
    const currentMatch = config.rules.find((rule) => rule.enabled && rule.type === "MATCH");
    generated.push(currentMatch ? { ...currentMatch, id: createId() } : { id: createId(), type: "MATCH", value: "", target, options: [], enabled: true });
  }
  if (mode === "replace") return { ...config, rules: generated };
  const generatedMatch = generated.find((rule) => rule.type === "MATCH");
  const trailingMatch = generatedMatch ? [generatedMatch] : config.rules.filter((rule) => rule.type === "MATCH");
  return { ...config, rules: [...config.rules.filter((rule) => rule.type !== "MATCH"), ...generated.filter((rule) => rule.type !== "MATCH"), ...trailingMatch] };
}
