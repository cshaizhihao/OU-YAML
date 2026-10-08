import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpenCheck, Check, CheckCircle2, Code2, Copy, Info, LayoutTemplate, ListChecks, Pencil, Plus, Search, Sparkles, Square, Trash2, XCircle } from "lucide-react";
import type { MihomoConfig, RuleItem } from "../../shared/types";
import { applyRuleTemplate, ruleTemplates } from "../../shared/ruleTemplates";
import { createId } from "../../shared/id";
import { getRuleDefinition, ruleCatalog, ruleOptionLabel, ruleSentence, ruleSourcePreview, ruleTargetLabel, ruleTypeLabel } from "../../shared/ruleCatalog";
import { guideTargets } from "../../guides/registry";
import { duplicateRule, createScenarioRule, inspectRules, explainDomain } from "../../shared/ruleTools";
import { ConfirmDialog, Drawer } from "../Dialog";

type EditorMode = "beginner" | "advanced";

const blankRule = (target: string): RuleItem => ({ id: createId(), type: "DOMAIN-SUFFIX", value: "", target, options: [], enabled: true });

function targetOptions(config: MihomoConfig) {
  return ["DIRECT", "REJECT", ...config.proxyGroups.map((group) => group.name)];
}

function ruleMatchesQuery(rule: RuleItem, query: string) {
  const definition = getRuleDefinition(rule.type);
  return `${rule.type} ${definition.label} ${definition.description} ${rule.value} ${rule.target} ${ruleTargetLabel(rule.target)} ${rule.comment || ""}`.toLowerCase().includes(query.trim().toLowerCase());
}

export function RulesView({ config, onChange }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void }) {
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(true);
  const [scenarioTarget, setScenarioTarget] = useState(config.proxyGroups[0]?.name || "DIRECT");
  const [explanation, setExplanation] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [deleting, setDeleting] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<EditorMode>(() => localStorage.getItem("ou-yaml:rule-editor-mode") === "advanced" ? "advanced" : "beginner");
  const targets = targetOptions(config);
  const visible = useMemo(() => config.rules.filter((rule) => ruleMatchesQuery(rule, query)), [config.rules, query]);
  const selectedRules = config.rules.filter((rule) => selected.has(rule.id));
  const allVisibleSelected = visible.length > 0 && visible.every((rule) => selected.has(rule.id));
  const matchRules = config.rules.filter((rule) => rule.enabled && rule.type === "MATCH");
  const matchReady = matchRules.length === 1 && config.rules.filter((rule) => rule.enabled).at(-1)?.id === matchRules[0]?.id;
  const ruleIssues = useMemo(() => inspectRules(config.rules), [config.rules]);

  useEffect(() => { localStorage.setItem("ou-yaml:rule-editor-mode", mode); }, [mode]);
  useEffect(() => {
    if (!targetOptions(config).includes(scenarioTarget)) setScenarioTarget(config.proxyGroups[0]?.name || "DIRECT");
  }, [config.proxyGroups, scenarioTarget]);

  const update = (id: string, values: Partial<RuleItem>) => onChange({ ...config, rules: config.rules.map((rule) => rule.id === id ? { ...rule, ...values } : rule) });
  const move = (id: string, direction: -1 | 1) => {
    const index = config.rules.findIndex((item) => item.id === id);
    const target = index + direction;
    if (target < 0 || target >= config.rules.length) return;
    const rules = [...config.rules];
    [rules[index], rules[target]] = [rules[target], rules[index]];
    onChange({ ...config, rules });
  };
  const addRule = () => {
    const rules = [...config.rules];
    const matchIndex = rules.findIndex((rule) => rule.type === "MATCH");
    const rule = blankRule(config.proxyGroups[0]?.name || "DIRECT");
    if (matchIndex < 0) rules.push(rule);
    else rules.splice(matchIndex, 0, rule);
    onChange({ ...config, rules });
    setQuery("");
    setMode("beginner");
    setEditingId(rule.id);
  };
  const changeType = (rule: RuleItem, type: string) => {
    const next = config.rules.map((item) => item.id === rule.id ? { ...item, type, value: type === "MATCH" ? "" : item.value } : item);
    if (type === "MATCH") {
      const index = next.findIndex((item) => item.id === rule.id);
      const [match] = next.splice(index, 1);
      next.push(match);
    }
    onChange({ ...config, rules: next });
  };
  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    checked ? next.add(id) : next.delete(id);
    return next;
  });
  const batchEnabled = (enabled: boolean) => onChange({ ...config, rules: config.rules.map((rule) => selected.has(rule.id) ? { ...rule, enabled } : rule) });
  return <div className="rules-editor">
    <section className="rule-scenario" data-guide-id={guideTargets.ruleScenario}>
      <header><h2>为网站指定线路</h2><button className="text-button" onClick={() => setHelpOpen(true)}><BookOpenCheck size={15} />规则说明</button></header>
      <form className="scenario-fields" onSubmit={(event) => { event.preventDefault(); try { const rule = createScenarioRule(domain, scenarioTarget, includeSubdomains); onChange({ ...config, rules: [rule, ...config.rules] }); setQuery(""); setExplanation("已添加到最前面，检查并发布后生效。"); window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: "website-rule-added" })); } catch (error) { setExplanation((error as Error).message); } }}>
        <label className="scenario-domain">网站域名<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="例如 example.com" /></label>
        <label className="scenario-target">连接方式<select value={scenarioTarget} onChange={(event) => setScenarioTarget(event.target.value)}>{targets.map((target) => <option key={target} value={target}>{ruleTargetLabel(target)}</option>)}</select></label>
        <button className="primary-button" type="submit">添加网站规则</button>
        <div className="scenario-options"><label><input type="checkbox" checked={includeSubdomains} onChange={(event) => setIncludeSubdomains(event.target.checked)} />包含子域名</label><button className="text-button" type="button" onClick={() => { try { const result = explainDomain(config.rules, domain); setExplanation(`${result.uncertain.length ? `前面有 ${result.uncertain.join("、")} 规则，需要实际 IP、分类库或进程信息才能确定。仅按域名推演：` : "按域名匹配："}${result.rule ? `${ruleTypeLabel(result.rule.type)} → ${ruleTargetLabel(result.rule.target)}` : "没有匹配规则"}`); } catch (error) { setExplanation((error as Error).message); } }}>检查匹配结果</button></div>
      </form>
      {explanation && <p role="status">{explanation}</p>}
    </section>

    <div className="rules-toolbar">
        <div className="editor-mode-switch" data-guide-id={guideTargets.ruleMode} role="group" aria-label="规则编辑模式">
          <button className={mode === "beginner" ? "active" : ""} aria-pressed={mode === "beginner"} onClick={() => setMode("beginner")}><ListChecks size={16} />新手模式</button>
          <button className={mode === "advanced" ? "active" : ""} aria-pressed={mode === "advanced"} onClick={() => setMode("advanced")}><Code2 size={16} />高级模式</button>
        </div>
        <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索中文类型、匹配内容、策略或备注" aria-label="搜索规则" /></label>
      <div className="toolbar-actions"><button className="secondary-button" data-guide-id={guideTargets.ruleTemplates} onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={17} />规则模板</button><button className="primary-button" data-guide-id={guideTargets.ruleAdd} onClick={addRule}><Plus size={17} />添加规则</button></div>
    </div>

    <div className="rule-overview" data-guide-id={guideTargets.ruleList}>
      <span><strong>{config.rules.length}</strong> 条规则 · 从上往下匹配</span>
      <span className={matchReady ? "ready" : "warning"}>{matchReady ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{matchReady ? "最终兜底规则正确" : matchRules.length > 1 ? "存在多条兜底规则" : matchRules.length ? "兜底规则需要放在最后" : "缺少最终兜底规则"}</span>
    </div>

    {ruleIssues.length > 0 && <details className="rule-issues"><summary>{ruleIssues.length} 条规则提醒</summary>{ruleIssues.map((message) => <p key={message}>{message}</p>)}</details>}

    {selectedRules.length > 0 && <div className="rule-batch-bar"><span>已选择 <strong>{selectedRules.length}</strong> 条</span><button className="secondary-button compact-button" onClick={() => batchEnabled(true)}><CheckCircle2 size={14} />启用</button><button className="secondary-button compact-button" onClick={() => batchEnabled(false)}><Square size={14} />停用</button><button className="secondary-button compact-button danger-outline" onClick={() => setDeleting(selectedRules.map((rule) => rule.id))}><Trash2 size={14} />删除</button><button className="text-button" onClick={() => setSelected(new Set())}>取消选择</button></div>}

    <div>
      {mode === "beginner"
        ? <BeginnerRuleList rules={visible} allRules={config.rules} targets={targets} selected={selected} editingId={editingId} onEdit={setEditingId} onSelect={toggleSelected} onUpdate={update} onChangeType={changeType} onMove={move} onDuplicate={(rule) => onChange({ ...config, rules: duplicateRule(config.rules, rule) })} onDelete={(id) => setDeleting([id])} />
        : <AdvancedRuleTable visible={visible} config={config} targets={targets} selected={selected} allVisibleSelected={allVisibleSelected} onSelected={setSelected} onSelect={toggleSelected} onUpdate={update} onChangeType={changeType} onMove={move} onChange={onChange} onDelete={(id) => setDeleting([id])} />}
    </div>

    <TemplateDrawer open={templatesOpen} config={config} onClose={() => setTemplatesOpen(false)} onApply={(template, target, applyMode) => { onChange(applyRuleTemplate(config, template, target, applyMode)); setTemplatesOpen(false); }} />
    <Drawer title="怎样编写分流规则" size="compact" open={helpOpen} onClose={() => setHelpOpen(false)}><div className="rules-help"><p>先填写网站，再选择连接方式。中文只帮助理解，实际配置仍使用标准英文。</p><ol><li>直接连接：不经过代理。</li><li>选择代理组：交给该组选择节点。</li><li>拒绝连接：拦截这个网站。</li></ol><p>规则从上往下匹配，越具体的越靠前；最终兜底放在最后。</p><code>DOMAIN-SUFFIX,example.com,DIRECT</code><p>这表示 example.com 及其子域名直接连接。点击规则的“编辑”，可查看用途、参数和实际英文格式。</p></div></Drawer>
    <ConfirmDialog open={deleting.length > 0} title="删除规则" message={`确定删除这 ${deleting.length} 条规则吗？${config.rules.some((rule) => deleting.includes(rule.id) && rule.type === "MATCH") ? "其中包含最终兜底规则，删除后请重新指定未匹配流量的连接方式。" : "删除后不能在当前页面撤销。"}`} onClose={() => setDeleting([])} onConfirm={() => { onChange({ ...config, rules: config.rules.filter((rule) => !deleting.includes(rule.id)) }); setSelected((current) => new Set([...current].filter((id) => !deleting.includes(id)))); setDeleting([]); }} />
  </div>;
}

function BeginnerRuleList({ rules, allRules, targets, selected, editingId, onEdit, onSelect, onUpdate, onChangeType, onMove, onDuplicate, onDelete }: {
  rules: RuleItem[];
  allRules: RuleItem[];
  targets: string[];
  selected: Set<string>;
  editingId: string;
  onEdit: (id: string) => void;
  onSelect: (id: string, checked: boolean) => void;
  onUpdate: (id: string, value: Partial<RuleItem>) => void;
  onChangeType: (rule: RuleItem, type: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDuplicate: (rule: RuleItem) => void;
  onDelete: (id: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    editorRef.current?.scrollIntoView({ block: "nearest" });
    if (valueRef.current && !valueRef.current.value) valueRef.current.focus({ preventScroll: true });
  }, [editingId]);
  if (!rules.length) return <div className="table-empty">没有匹配的规则</div>;
  return <div className="beginner-rule-list">{rules.map((rule) => {
    const definition = getRuleDefinition(rule.type);
    const index = allRules.findIndex((item) => item.id === rule.id);
    const missingValue = rule.type !== "MATCH" && !rule.value.trim();
    const expanded = editingId === rule.id;
    return <article className={`beginner-rule-card${rule.enabled ? "" : " disabled"}${rule.type === "MATCH" ? " match-rule" : ""}${expanded ? " expanded" : ""}`} key={rule.id} aria-label={`规则 ${index + 1}：${rule.value || definition.label}`}>
      <header>
        <label className="rule-select-check"><input type="checkbox" checked={selected.has(rule.id)} onChange={(event) => onSelect(rule.id, event.target.checked)} /><span className="sr-only">选择规则</span></label>
        <span className="rule-order">{index + 1}</span>
        <div className="rule-summary"><strong title={rule.value || definition.label}>{rule.type === "MATCH" ? "其余全部流量" : rule.value || `待填写${definition.valueLabel}`}</strong><small title={ruleSentence(rule)}>{definition.label} → {ruleTargetLabel(rule.target, false)}{!rule.enabled && <em> · 已停用</em>}</small></div>
        <button className="text-button rule-edit-toggle" aria-expanded={expanded} onClick={() => onEdit(expanded ? "" : rule.id)}><Pencil size={14} />{expanded ? "收起" : "编辑"}</button>
      </header>
      {expanded && <div className="rule-inline-editor" ref={editorRef}>
      <div className="rule-sentence-builder">
        <label>匹配方式<select value={rule.type} onChange={(event) => onChangeType(rule, event.target.value)}>{!ruleCatalog.some((item) => item.type === rule.type) && <option value={rule.type}>{ruleTypeLabel(rule.type)}</option>}{ruleCatalog.map((item) => <option value={item.type} key={item.type}>{item.label}（{item.type}）</option>)}</select></label>
        {rule.type !== "MATCH" && <label className={missingValue ? "has-error" : ""}>{definition.valueLabel}<input ref={valueRef} value={rule.value} onChange={(event) => onUpdate(rule.id, { value: event.target.value })} placeholder={definition.placeholder} /></label>}
        <label>目标策略<select value={rule.target} onChange={(event) => onUpdate(rule.id, { target: event.target.value })}>{targets.map((target) => <option value={target} key={target}>{ruleTargetLabel(target)}</option>)}</select></label>
      </div>
      <div className="rule-explanation"><Info size={15} /><span><strong>{ruleSentence(rule)}</strong><small>{definition.description}{definition.example ? ` 示例：${definition.example}` : ""}</small></span></div>
      {missingValue && <div className="rule-inline-error">请填写{definition.valueLabel}</div>}
      <details className="rule-advanced-details">
        <summary><Code2 size={15} />高级设置与英文原文</summary>
        <div className="rule-advanced-grid">
          <label>附加参数<input value={rule.options.join(",")} onChange={(event) => onUpdate(rule.id, { options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="例如 no-resolve" /><small>{rule.options.map((option) => ruleOptionLabel(option)).join("、") || "通常可以留空"}</small></label>
          <label>备注<input value={rule.comment || ""} onChange={(event) => onUpdate(rule.id, { comment: event.target.value })} placeholder="仅用于帮助自己理解" /></label>
          <code>{ruleSourcePreview(rule)}</code>
        </div>
      </details>
      <footer><label className="rule-enabled-toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => onUpdate(rule.id, { enabled: event.target.checked })} /><span>启用规则</span></label><div className="row-actions"><button className="icon-button compact" disabled={index === 0} onClick={() => onMove(rule.id, -1)} aria-label="上移规则"><ArrowUp size={16} /></button><button className="icon-button compact" disabled={index === allRules.length - 1} onClick={() => onMove(rule.id, 1)} aria-label="下移规则"><ArrowDown size={16} /></button>{rule.type !== "MATCH" && <button className="icon-button compact" onClick={() => onDuplicate(rule)} aria-label="复制规则"><Copy size={15} /></button>}<button className="icon-button compact danger" onClick={() => onDelete(rule.id)} aria-label="删除规则"><Trash2 size={15} /></button></div></footer>
      </div>}
    </article>;
  })}</div>;
}

function AdvancedRuleTable({ visible, config, targets, selected, allVisibleSelected, onSelected, onSelect, onUpdate, onChangeType, onMove, onChange, onDelete }: {
  visible: RuleItem[];
  config: MihomoConfig;
  targets: string[];
  selected: Set<string>;
  allVisibleSelected: boolean;
  onSelected: (value: Set<string>) => void;
  onSelect: (id: string, checked: boolean) => void;
  onUpdate: (id: string, value: Partial<RuleItem>) => void;
  onChangeType: (rule: RuleItem, type: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onChange: (config: MihomoConfig) => void;
  onDelete: (id: string) => void;
}) {
  return <div className="data-table-wrap rules-table-wrap">
    <table className="data-table rules-table">
      <thead><tr><th><input className="table-check" type="checkbox" checked={allVisibleSelected} onChange={(event) => onSelected(event.target.checked ? new Set([...selected, ...visible.map((rule) => rule.id)]) : new Set([...selected].filter((id) => !visible.some((rule) => rule.id === id))))} aria-label="选择当前规则" /></th><th>启用</th><th>规则类型</th><th>匹配内容</th><th>目标策略</th><th>附加参数</th><th>备注</th><th><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{visible.map((rule) => {
        const definition = getRuleDefinition(rule.type);
        return <tr key={rule.id} className={rule.enabled ? "" : "disabled-row"}>
          <td data-label="选择"><input className="table-check" type="checkbox" checked={selected.has(rule.id)} onChange={(event) => onSelect(rule.id, event.target.checked)} aria-label={`选择 ${ruleTypeLabel(rule.type, false)} 规则`} /></td>
          <td data-label="启用"><input className="table-check" type="checkbox" checked={rule.enabled} onChange={(event) => onUpdate(rule.id, { enabled: event.target.checked })} aria-label={`启用 ${ruleTypeLabel(rule.type, false)} 规则`} /></td>
          <td data-label="规则类型"><select value={rule.type} title={definition.description} onChange={(event) => onChangeType(rule, event.target.value)}>{!ruleCatalog.some((item) => item.type === rule.type) && <option value={rule.type}>{ruleTypeLabel(rule.type)}</option>}{ruleCatalog.map((item) => <option value={item.type} key={item.type}>{item.label}（{item.type}）</option>)}</select></td>
          <td data-label="匹配内容"><input value={rule.value} disabled={rule.type === "MATCH"} onChange={(event) => onUpdate(rule.id, { value: event.target.value })} placeholder={definition.placeholder} /></td>
          <td data-label="目标策略"><select value={rule.target} onChange={(event) => onUpdate(rule.id, { target: event.target.value })}>{targets.map((target) => <option value={target} key={target}>{ruleTargetLabel(target)}</option>)}</select></td>
          <td data-label="附加参数"><input value={rule.options.join(",")} onChange={(event) => onUpdate(rule.id, { options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="不解析 DNS（no-resolve）" /></td>
          <td data-label="备注"><input value={rule.comment || ""} onChange={(event) => onUpdate(rule.id, { comment: event.target.value })} placeholder="可选" /></td>
          <td data-label="操作"><div className="row-actions"><button className="icon-button compact" disabled={config.rules[0]?.id === rule.id} onClick={() => onMove(rule.id, -1)} aria-label="上移规则"><ArrowUp size={16} /></button><button className="icon-button compact" disabled={config.rules.at(-1)?.id === rule.id} onClick={() => onMove(rule.id, 1)} aria-label="下移规则"><ArrowDown size={16} /></button><button className="icon-button compact" disabled={rule.type === "MATCH"} onClick={() => onChange({ ...config, rules: duplicateRule(config.rules, rule) })} aria-label="复制规则"><Copy size={16} /></button><button className="icon-button compact danger" onClick={() => onDelete(rule.id)} aria-label="删除规则"><Trash2 size={16} /></button></div></td>
        </tr>;
      })}</tbody>
    </table>
    {!visible.length && <div className="table-empty">没有匹配的规则</div>}
  </div>;
}

function TemplateDrawer({ open, config, onClose, onApply }: { open: boolean; config: MihomoConfig; onClose: () => void; onApply: (template: string, target: string, mode: "append" | "replace") => void }) {
  const [selected, setSelected] = useState("balanced");
  const [target, setTarget] = useState(config.proxyGroups[0]?.name || "DIRECT");
  const [mode, setMode] = useState<"append" | "replace">("append");
  return <Drawer title="一键应用中文规则模板" open={open} onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onApply(selected, target, mode)}><Check size={17} />应用模板</button></>}>
    <div className="template-helper"><Sparkles size={17} /><span><strong>第一次使用推荐“基础分流”</strong><small>模板写入的仍然是标准英文规则，可随时在编辑器中调整。</small></span></div>
    <div className="template-list">{ruleTemplates.map((template) => <button key={template.id} className={selected === template.id ? "template-option active" : "template-option"} onClick={() => setSelected(template.id)}><span><LayoutTemplate size={18} /></span><strong>{template.name}</strong><small>{template.rules.length} 条规则</small>{selected === template.id && <Check size={17} />}</button>)}</div>
    <div className="form-grid template-settings"><label>默认目标策略<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="DIRECT">直接连接（DIRECT）</option>{config.proxyGroups.map((group) => <option key={group.id} value={group.name}>{group.name}</option>)}</select></label><label>应用方式<select value={mode} onChange={(event) => setMode(event.target.value as "append" | "replace")}><option value="append">追加并保留现有规则</option><option value="replace">替换现有规则</option></select></label></div>
  </Drawer>;
}
