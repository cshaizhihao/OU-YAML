import type { RuleItem } from "./types";

export type RuleDefinition = {
  type: string;
  label: string;
  description: string;
  valueLabel: string;
  placeholder: string;
  example: string;
};

export const ruleCatalog: readonly RuleDefinition[] = [
  { type: "DOMAIN", label: "完整域名匹配", description: "只匹配填写的完整域名，不包含它的子域名。", valueLabel: "完整域名", placeholder: "例如 www.example.com", example: "www.example.com" },
  { type: "DOMAIN-SUFFIX", label: "域名后缀匹配", description: "匹配该域名以及它下面的所有子域名，最适合常规网站分流。", valueLabel: "域名后缀", placeholder: "例如 example.com", example: "example.com" },
  { type: "DOMAIN-KEYWORD", label: "域名关键词匹配", description: "域名中只要包含该关键词就会命中，请避免使用过短的文字。", valueLabel: "域名关键词", placeholder: "例如 google", example: "google" },
  { type: "IP-CIDR", label: "IPv4 地址范围", description: "匹配一个 IPv4 地址或网段，通常用于局域网和固定服务器。", valueLabel: "IPv4 或网段", placeholder: "例如 192.168.1.0/24", example: "192.168.1.0/24" },
  { type: "IP-CIDR6", label: "IPv6 地址范围", description: "匹配一个 IPv6 地址或网段。", valueLabel: "IPv6 或网段", placeholder: "例如 2001:db8::/32", example: "2001:db8::/32" },
  { type: "GEOIP", label: "国家或地区 IP", description: "按照 IP 所属国家或地区匹配，常用 CN 表示中国大陆。", valueLabel: "国家或地区代码", placeholder: "例如 CN", example: "CN" },
  { type: "GEOSITE", label: "网站分类", description: "使用 Mihomo 的网站分类数据库匹配一类网站。", valueLabel: "网站分类", placeholder: "例如 category-ads-all", example: "category-ads-all" },
  { type: "PROCESS-NAME", label: "应用进程名称", description: "按照发起连接的应用程序名称匹配，部分客户端或系统可能不支持。", valueLabel: "进程名称", placeholder: "例如 Telegram.exe", example: "Telegram.exe" },
  { type: "RULE-SET", label: "远程规则集", description: "引用已经配置的规则集名称，适合维护大量规则。", valueLabel: "规则集名称", placeholder: "例如 reject", example: "reject" },
  { type: "MATCH", label: "最终兜底规则", description: "前面的规则都没有命中时使用，应该只保留一条并放在最后。", valueLabel: "无需填写", placeholder: "兜底规则无需填写", example: "" },
] as const;

const definitions = new Map(ruleCatalog.map((item) => [item.type, item]));

export function getRuleDefinition(type: string): RuleDefinition {
  return definitions.get(type) || {
    type,
    label: "自定义规则",
    description: "这是从配置中导入的自定义规则类型，请在高级模式中确认参数。",
    valueLabel: "匹配内容",
    placeholder: "请输入匹配内容",
    example: "",
  };
}

export function ruleTypeLabel(type: string, includeCode = true) {
  const definition = getRuleDefinition(type);
  return includeCode ? `${definition.label}（${type}）` : definition.label;
}

export function ruleTargetLabel(target: string, includeCode = true) {
  if (target === "DIRECT") return includeCode ? "直接连接（DIRECT）" : "直接连接";
  if (target === "REJECT") return includeCode ? "拒绝连接（REJECT）" : "拒绝连接";
  return target;
}

export function ruleOptionLabel(option: string, includeCode = true) {
  if (option === "no-resolve") return includeCode ? "不进行 DNS 解析（no-resolve）" : "不进行 DNS 解析";
  return option;
}

export function ruleSentence(rule: RuleItem) {
  const definition = getRuleDefinition(rule.type);
  const condition = rule.type === "MATCH" ? "其他所有连接" : `${definition.label}“${rule.value || definition.example}”`;
  return `当 ${condition} 时，使用 ${ruleTargetLabel(rule.target, false)}`;
}

export function ruleSourcePreview(rule: RuleItem) {
  const fields = rule.type === "MATCH" ? [rule.type, rule.target] : [rule.type, rule.value, rule.target];
  return [...fields, ...rule.options].filter(Boolean).join(",");
}
