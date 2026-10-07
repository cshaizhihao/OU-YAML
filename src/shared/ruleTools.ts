import { createId } from "./id";
import type { RuleItem } from "./types";

export function duplicateRule(rules: RuleItem[], rule: RuleItem) {
  if (rule.type === "MATCH") return rules;
  const next = [...rules];
  next.splice(Math.max(0, rules.findIndex((item) => item.id === rule.id) + 1), 0, { ...rule, id: createId(), options: [...rule.options] });
  return next;
}

export function normalizeRuleDomain(input: string) {
  const value = input.trim();
  if (!value || /[\s/*?#:@]/.test(value)) throw new Error("请只填写域名，例如 example.com，不要包含协议、路径或端口");
  const hostname = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(hostname) || hostname.length > 253 || !hostname.includes(".") || hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("域名格式无效，请检查拼写");
  return hostname;
}

export function createScenarioRule(domain: string, target: string, includeSubdomains = true): RuleItem {
  return { id: createId(), type: includeSubdomains ? "DOMAIN-SUFFIX" : "DOMAIN", value: normalizeRuleDomain(domain), target, options: [], enabled: true };
}

export function inspectRules(rules: RuleItem[]) {
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules.filter((item) => item.enabled)) {
    const key = `${rule.type}:${rule.value.toLowerCase()}`;
    if (seen.has(key)) messages.push(`重复匹配：${rule.type} ${rule.value || "兜底规则"}，后面的同类规则可能不会生效`);
    seen.add(key);
    if (["DOMAIN", "DOMAIN-SUFFIX"].includes(rule.type)) {
      try { normalizeRuleDomain(rule.value); } catch (error) { messages.push(error instanceof Error ? error.message : "域名无效"); }
    }
  }
  return [...new Set(messages)];
}

export function explainDomain(rules: RuleItem[], input: string) {
  const domain = normalizeRuleDomain(input);
  const uncertain: string[] = [];
  for (const rule of rules.filter((item) => item.enabled)) {
    const value = rule.value.toLowerCase();
    const matched = rule.type === "DOMAIN" ? domain === value : rule.type === "DOMAIN-SUFFIX" ? domain === value || domain.endsWith(`.${value}`) : rule.type === "DOMAIN-KEYWORD" ? domain.includes(value) : rule.type === "MATCH";
    if (!["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "MATCH"].includes(rule.type)) uncertain.push(rule.type);
    if (matched) return { rule, domain, uncertain: [...new Set(uncertain)] };
  }
  return { rule: undefined, domain, uncertain: [...new Set(uncertain)] };
}
