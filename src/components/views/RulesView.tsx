import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, LayoutTemplate, Plus, Search, Trash2 } from "lucide-react";
import type { MihomoConfig, RuleItem } from "../../shared/types";
import { applyRuleTemplate, ruleTemplates } from "../../shared/ruleTemplates";
import { Drawer } from "../Dialog";

const ruleTypes = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6", "GEOIP", "GEOSITE", "PROCESS-NAME", "RULE-SET", "MATCH"];
const blankRule = (): RuleItem => ({ id: crypto.randomUUID(), type: "DOMAIN-SUFFIX", value: "", target: "DIRECT", options: [], enabled: true });

export function RulesView({ config, onChange }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void }) {
  const [query, setQuery] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const targets = ["DIRECT", "REJECT", ...config.proxyGroups.map((group) => group.name)];
  const visible = useMemo(() => config.rules.filter((rule) => `${rule.type} ${rule.value} ${rule.target}`.toLowerCase().includes(query.toLowerCase())), [config.rules, query]);
  const update = (id: string, values: Partial<RuleItem>) => onChange({ ...config, rules: config.rules.map((rule) => rule.id === id ? { ...rule, ...values } : rule) });
  const move = (id: string, direction: -1 | 1) => { const index = config.rules.findIndex((item) => item.id === id); const target = index + direction; if (target < 0 || target >= config.rules.length) return; const rules = [...config.rules]; [rules[index], rules[target]] = [rules[target], rules[index]]; onChange({ ...config, rules }); };
  return <>
    <div className="view-toolbar"><label className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索规则" aria-label="搜索规则" /></label><div className="toolbar-actions"><button className="secondary-button" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={17} />模板</button><button className="primary-button" onClick={() => onChange({ ...config, rules: [...config.rules, blankRule()] })}><Plus size={17} />添加规则</button></div></div>
    <div className="data-table-wrap rules-table-wrap"><table className="data-table rules-table"><thead><tr><th>启用</th><th>类型</th><th>匹配内容</th><th>目标策略</th><th>附加参数</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{visible.map((rule) => <tr key={rule.id} className={rule.enabled ? "" : "disabled-row"}><td><input className="table-check" type="checkbox" checked={rule.enabled} onChange={(e) => update(rule.id, { enabled: e.target.checked })} aria-label={`启用 ${rule.type} 规则`} /></td><td><select value={rule.type} onChange={(e) => update(rule.id, { type: e.target.value })}>{ruleTypes.map((type) => <option key={type}>{type}</option>)}</select></td><td><input value={rule.value} disabled={rule.type === "MATCH"} onChange={(e) => update(rule.id, { value: e.target.value })} placeholder={rule.type === "MATCH" ? "兜底规则" : "匹配值"} /></td><td><select value={rule.target} onChange={(e) => update(rule.id, { target: e.target.value })}>{targets.map((target) => <option key={target}>{target}</option>)}</select></td><td><input value={rule.options.join(",")} onChange={(e) => update(rule.id, { options: e.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="no-resolve" /></td><td><div className="row-actions"><button className="icon-button compact" onClick={() => move(rule.id, -1)} aria-label="上移规则"><ArrowUp size={16} /></button><button className="icon-button compact" onClick={() => move(rule.id, 1)} aria-label="下移规则"><ArrowDown size={16} /></button><button className="icon-button compact" onClick={() => onChange({ ...config, rules: [...config.rules, { ...rule, id: crypto.randomUUID() }] })} aria-label="复制规则"><Copy size={16} /></button><button className="icon-button compact danger" onClick={() => onChange({ ...config, rules: config.rules.filter((item) => item.id !== rule.id) })} aria-label="删除规则"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table>{!visible.length && <div className="table-empty">没有匹配的规则</div>}</div>
    <TemplateDrawer open={templatesOpen} config={config} onClose={() => setTemplatesOpen(false)} onApply={(template, target, mode) => { onChange(applyRuleTemplate(config, template, target, mode)); setTemplatesOpen(false); }} />
  </>;
}

function TemplateDrawer({ open, config, onClose, onApply }: { open: boolean; config: MihomoConfig; onClose: () => void; onApply: (template: string, target: string, mode: "append" | "replace") => void }) {
  const [selected, setSelected] = useState("balanced");
  const [target, setTarget] = useState(config.proxyGroups[0]?.name || "DIRECT");
  const [mode, setMode] = useState<"append" | "replace">("append");
  return <Drawer title="规则模板" open={open} onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onApply(selected, target, mode)}><Check size={17} />应用模板</button></>}>
    <div className="template-list">{ruleTemplates.map((template) => <button key={template.id} className={selected === template.id ? "template-option active" : "template-option"} onClick={() => setSelected(template.id)}><span><LayoutTemplate size={18} /></span><strong>{template.name}</strong><small>{template.rules.length} 条规则</small>{selected === template.id && <Check size={17} />}</button>)}</div>
    <div className="form-grid template-settings"><label>目标策略<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="DIRECT">DIRECT</option>{config.proxyGroups.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}</select></label><label>应用方式<select value={mode} onChange={(event) => setMode(event.target.value as "append" | "replace")}><option value="append">追加</option><option value="replace">替换</option></select></label></div>
  </Drawer>;
}
