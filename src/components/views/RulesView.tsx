import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, CheckCircle2, Copy, LayoutTemplate, Plus, Search, Square, Trash2, XCircle } from "lucide-react";
import type { MihomoConfig, RuleItem } from "../../shared/types";
import { applyRuleTemplate, ruleTemplates } from "../../shared/ruleTemplates";
import { createId } from "../../shared/id";
import { Drawer } from "../Dialog";

const ruleTypes = ["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6", "GEOIP", "GEOSITE", "PROCESS-NAME", "RULE-SET", "MATCH"];
const blankRule = (): RuleItem => ({ id: createId(), type: "DOMAIN-SUFFIX", value: "", target: "DIRECT", options: [], enabled: true });

export function RulesView({ config, onChange }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void }) {
  const [query, setQuery] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const targets = ["DIRECT", "REJECT", ...config.proxyGroups.map((group) => group.name)];
  const visible = useMemo(() => config.rules.filter((rule) => `${rule.type} ${rule.value} ${rule.target} ${rule.comment || ""}`.toLowerCase().includes(query.toLowerCase())), [config.rules, query]);
  const selectedRules = config.rules.filter((rule) => selected.has(rule.id));
  const allVisibleSelected = visible.length > 0 && visible.every((rule) => selected.has(rule.id));

  const update = (id: string, values: Partial<RuleItem>) => onChange({ ...config, rules: config.rules.map((rule) => rule.id === id ? { ...rule, ...values } : rule) });
  const move = (id: string, direction: -1 | 1) => {
    const index = config.rules.findIndex((item) => item.id === id);
    const target = index + direction;
    if (target < 0 || target >= config.rules.length) return;
    const rules = [...config.rules];
    [rules[index], rules[target]] = [rules[target], rules[index]];
    onChange({ ...config, rules });
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    checked ? next.add(id) : next.delete(id);
    return next;
  });
  const batchEnabled = (enabled: boolean) => onChange({ ...config, rules: config.rules.map((rule) => selected.has(rule.id) ? { ...rule, enabled } : rule) });
  const deleteSelected = () => {
    onChange({ ...config, rules: config.rules.filter((rule) => !selected.has(rule.id)) });
    setSelected(new Set());
  };

  return <>
    <div className="view-toolbar rules-toolbar">
      <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索类型、匹配内容、策略或备注" aria-label="搜索规则" /></label>
      <div className="toolbar-actions"><button className="secondary-button" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={17} />规则模板</button><button className="primary-button" onClick={() => onChange({ ...config, rules: [...config.rules, blankRule()] })}><Plus size={17} />添加规则</button></div>
    </div>

    <div className="rule-overview">
      <span><strong>{config.rules.length}</strong> 条规则</span>
      <span><strong>{config.rules.filter((rule) => rule.enabled).length}</strong> 条启用</span>
      <span className={config.rules.some((rule) => rule.enabled && rule.type === "MATCH") ? "ready" : "warning"}>{config.rules.some((rule) => rule.enabled && rule.type === "MATCH") ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{config.rules.some((rule) => rule.enabled && rule.type === "MATCH") ? "已有兜底规则" : "缺少 MATCH 兜底"}</span>
    </div>

    {selected.size > 0 && <div className="rule-batch-bar"><span>已选择 <strong>{selectedRules.length}</strong> 条</span><button className="secondary-button compact-button" onClick={() => batchEnabled(true)}><CheckCircle2 size={14} />启用</button><button className="secondary-button compact-button" onClick={() => batchEnabled(false)}><Square size={14} />停用</button><button className="secondary-button compact-button danger-outline" onClick={deleteSelected}><Trash2 size={14} />删除</button><button className="text-button" onClick={() => setSelected(new Set())}>取消选择</button></div>}

    <div className="data-table-wrap rules-table-wrap">
      <table className="data-table rules-table">
        <thead><tr><th><input className="table-check" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set([...selected, ...visible.map((rule) => rule.id)]) : new Set([...selected].filter((id) => !visible.some((rule) => rule.id === id))))} aria-label="选择当前规则" /></th><th>启用</th><th>类型</th><th>匹配内容</th><th>目标策略</th><th>附加参数</th><th>备注</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{visible.map((rule) => <tr key={rule.id} className={rule.enabled ? "" : "disabled-row"}>
          <td data-label="选择"><input className="table-check" type="checkbox" checked={selected.has(rule.id)} onChange={(event) => toggleSelected(rule.id, event.target.checked)} aria-label={`选择 ${rule.type} 规则`} /></td>
          <td data-label="启用"><input className="table-check" type="checkbox" checked={rule.enabled} onChange={(event) => update(rule.id, { enabled: event.target.checked })} aria-label={`启用 ${rule.type} 规则`} /></td>
          <td data-label="类型"><select value={rule.type} onChange={(event) => update(rule.id, { type: event.target.value, value: event.target.value === "MATCH" ? "" : rule.value })}>{ruleTypes.map((type) => <option key={type}>{type}</option>)}</select></td>
          <td data-label="匹配内容"><input value={rule.value} disabled={rule.type === "MATCH"} onChange={(event) => update(rule.id, { value: event.target.value })} placeholder={rule.type === "MATCH" ? "兜底规则无需填写" : "匹配值"} /></td>
          <td data-label="目标策略"><select value={rule.target} onChange={(event) => update(rule.id, { target: event.target.value })}>{targets.map((target) => <option key={target}>{target}</option>)}</select></td>
          <td data-label="附加参数"><input value={rule.options.join(",")} onChange={(event) => update(rule.id, { options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="no-resolve" /></td>
          <td data-label="备注"><input value={rule.comment || ""} onChange={(event) => update(rule.id, { comment: event.target.value })} placeholder="可选" /></td>
          <td data-label="操作"><div className="row-actions"><button className="icon-button compact" disabled={config.rules[0]?.id === rule.id} onClick={() => move(rule.id, -1)} aria-label="上移规则"><ArrowUp size={16} /></button><button className="icon-button compact" disabled={config.rules.at(-1)?.id === rule.id} onClick={() => move(rule.id, 1)} aria-label="下移规则"><ArrowDown size={16} /></button><button className="icon-button compact" onClick={() => onChange({ ...config, rules: [...config.rules, { ...rule, id: createId() }] })} aria-label="复制规则"><Copy size={16} /></button><button className="icon-button compact danger" onClick={() => onChange({ ...config, rules: config.rules.filter((item) => item.id !== rule.id) })} aria-label="删除规则"><Trash2 size={16} /></button></div></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <div className="table-empty">没有匹配的规则</div>}
    </div>

    <TemplateDrawer open={templatesOpen} config={config} onClose={() => setTemplatesOpen(false)} onApply={(template, target, mode) => { onChange(applyRuleTemplate(config, template, target, mode)); setTemplatesOpen(false); }} />
  </>;
}

function TemplateDrawer({ open, config, onClose, onApply }: { open: boolean; config: MihomoConfig; onClose: () => void; onApply: (template: string, target: string, mode: "append" | "replace") => void }) {
  const [selected, setSelected] = useState("balanced");
  const [target, setTarget] = useState(config.proxyGroups[0]?.name || "DIRECT");
  const [mode, setMode] = useState<"append" | "replace">("append");
  return <Drawer title="应用规则模板" open={open} onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onApply(selected, target, mode)}><Check size={17} />应用模板</button></>}>
    <div className="template-list">{ruleTemplates.map((template) => <button key={template.id} className={selected === template.id ? "template-option active" : "template-option"} onClick={() => setSelected(template.id)}><span><LayoutTemplate size={18} /></span><strong>{template.name}</strong><small>{template.rules.length} 条规则</small>{selected === template.id && <Check size={17} />}</button>)}</div>
    <div className="form-grid template-settings"><label>目标策略<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="DIRECT">DIRECT</option>{config.proxyGroups.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}</select></label><label>应用方式<select value={mode} onChange={(event) => setMode(event.target.value as "append" | "replace")}><option value="append">追加到现有规则</option><option value="replace">替换现有规则</option></select></label></div>
  </Drawer>;
}
