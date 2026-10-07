import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, LoaderCircle } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode } from "../../shared/domain";
import type { MihomoConfig } from "../../shared/types";
import type { SubscriptionEditorState, SubscriptionEditorTab } from "../../shared/subscriptionEditor";
import { previewExport } from "../../shared/exportConfig";
import { refreshProfileConfig } from "../../shared/publication";
import { guideTargets } from "../../guides/registry";
import { GroupsView } from "./GroupsView";
import { RulesView } from "./RulesView";

export function SubscriptionEditorView({ id, initialTab, onBack, onMessage }: { id: string; initialTab: SubscriptionEditorTab; onBack: () => void; onMessage: (message: string) => void }) {
  const [original, setOriginal] = useState<SubscriptionEditorState | null>(null);
  const [config, setConfig] = useState<MihomoConfig | null>(null);
  const [name, setName] = useState("");
  const [tab, setTab] = useState(initialTab);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [nodeLimit, setNodeLimit] = useState(100);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dirty = Boolean(original && config && (name !== original.subscription.name || JSON.stringify(config) !== JSON.stringify(original.config) || selected.size !== config.proxies.length || config.proxies.some((node) => !selected.has(node.id))));

  useEffect(() => {
    let cancelled = false;
    setError("");
    void Promise.all([api.getSubscriptionEditor(id), api.listManagedNodes()]).then(([editor, managed]) => {
      if (cancelled) return;
      setOriginal(editor); setConfig(editor.config); setName(editor.subscription.name); setNodes(managed.filter((node) => node.enabled)); setSelected(new Set(editor.config.proxies.map((node) => node.id))); setReview(false); setSuccess("");
    }).catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    const beforeNavigate = (event: Event) => { if (busy || (dirty && !window.confirm("这份订阅还有未发布的修改，离开会丢弃。确定离开吗？"))) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("ou-yaml:before-navigate", beforeNavigate);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("ou-yaml:before-navigate", beforeNavigate); };
  }, [dirty, busy]);

  function change(next: MihomoConfig) { setConfig(next); setReview(false); setSuccess(""); }
  function prepare() {
    if (!config || !original) return;
    const rendered = previewExport(config, original.subscription.targetFormat);
    const errors = rendered.issues.filter((issue) => issue.level === "error");
    if (!config.proxies.length || errors.length) { setError(errors.map((issue) => issue.message).join("；") || "请至少选择一个节点"); return; }
    setError(""); setReview(true); setSuccess("");
  }
  async function save() {
    if (!original || !config || busy) return;
    setBusy(true); setError("");
    try {
      const updated = await api.saveSubscriptionEditor(id, { name: name.trim(), config, revision: original.revision });
      setOriginal(updated); setConfig(updated.config); setName(updated.subscription.name); setSelected(new Set(updated.config.proxies.map((node) => node.id))); setReview(false);
      setSuccess(`已更新原订阅 · 内容 v${updated.subscription.version}。客户端地址不变，请在客户端刷新订阅。${updated.kernelChecked ? "" : "当前服务器未提供内核，仅完成结构校验。"}`);
      window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: "subscription-updated" }));
    } catch (reason) { setError((reason as Error).message); setReview(false); }
    finally { setBusy(false); }
  }
  function reload() {
    if (dirty && !window.confirm("重新载入会丢弃未发布修改，确定继续吗？")) return;
    setOriginal(null); setConfig(null); setSuccess("");
    setAttempt((value) => value + 1);
  }

  if (!original || !config) return <section className="panel-card"><button className="text-button" onClick={onBack}><ArrowLeft size={16} />返回我的订阅</button>{error ? <><p role="alert">{error}</p><button className="secondary-button" onClick={reload}>重新载入</button></> : <p><LoaderCircle className="spin" size={18} /> 正在打开这份订阅…</p>}</section>;
  const nodeSelectionPending = selected.size !== config.proxies.length || config.proxies.some((node) => !selected.has(node.id));
  const available = [...config.proxies.filter((node) => !nodes.some((managed) => managed.id === node.id)), ...nodes].filter((node) => `${node.name} ${node.server}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="subscription-editor">
    <header className="editor-heading"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} />返回我的订阅</button><span>{busy ? "正在校验并更新…" : dirty ? "有未发布修改" : "与保存的订阅配置一致"}</span><button className="text-button" disabled={busy} onClick={reload}>重新载入</button></header>
    <section className="panel-card editor-identity"><label className="editor-name">订阅名称<input value={name} maxLength={120} disabled={busy} onChange={(event) => { setName(event.target.value); setReview(false); setSuccess(""); }} /></label><p>正在编辑「{original.subscription.name}」。节点、分组、分流都在这里；确认后更新这份订阅的原地址，不影响其他订阅。</p>{original.subscription.expiresAt && <p>链接有效期至 {new Date(original.subscription.expiresAt).toLocaleString("zh-CN")}；本次编辑不会延长有效期。</p>}</section>
    <nav className="section-tabs" aria-label="订阅编辑步骤">{([{ id: "nodes", name: "1. 选择节点" }, { id: "groups", name: "2. 编辑分组" }, { id: "rules", name: "3. 编辑分流" }] as const).map((item) => <button key={item.id} disabled={busy} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.name}</button>)}</nav>
    <div inert={busy}>
      {tab === "nodes" && <section className="panel-card"><h2>调整这份订阅的节点</h2><p>先在「订阅来源」导入，再在这里选择；新节点加入第一个代理组，可在下一步调整。</p><input aria-label="筛选订阅节点" placeholder="搜索节点名称或服务器" value={query} onChange={(event) => { setQuery(event.target.value); setNodeLimit(100); }} /><div className="quick-node-list">{available.slice(0, nodeLimit).map((node) => <label key={node.id}><input type="checkbox" checked={selected.has(node.id)} onChange={(event) => { setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(node.id) : next.delete(node.id); return next; }); setReview(false); }} /><span>{node.name}</span></label>)}</div>{available.length > nodeLimit && <button className="text-button" onClick={() => setNodeLimit(nodeLimit + 100)}>再显示 100 个节点</button>}<button className="secondary-button" disabled={!selected.size} onClick={() => { try { const existing = new Map(config.proxies.map((node) => [node.id, node])); const choices = [...config.proxies.filter((node) => !nodes.some((managed) => managed.id === node.id)), ...nodes].filter((node) => selected.has(node.id)).map((node) => existing.get(node.id) || node); change(refreshProfileConfig(config, choices, true)); setTab("groups"); } catch (reason) { setError((reason as Error).message); } }}>应用节点选择，继续编辑分组</button></section>}
      {tab === "groups" && <GroupsView config={config} onChange={change} onMessage={onMessage} />}
      {tab === "rules" && <section data-guide-id={guideTargets.subscriptionRules}><RulesView config={config} onChange={change} /></section>}
    </div>
    <section className="panel-card editor-publish" data-guide-id={guideTargets.subscriptionSave}>
      <h2>修改完成后，更新原订阅</h2><p>此页面不会自动发布。检查后确认，客户端继续使用原地址；离开未保存时会提醒。</p>
      {nodeSelectionPending && <p role="alert">节点勾选尚未应用，请返回「选择节点」点击应用后再发布。</p>}
      <button className="primary-button" disabled={busy || !name.trim() || nodeSelectionPending} onClick={prepare}>检查并更新原订阅</button>
      {review && <div className="publish-review" role="region" aria-label="更新原订阅确认"><h3>确认更新「{name.trim()}」</h3><p>节点 {original.config.proxies.length} → {config.proxies.length} · 代理组 {original.config.proxyGroups.length} → {config.proxyGroups.length} · 规则 {original.config.rules.length} → {config.rules.length}</p><p>原地址与有效期保持不变；校验失败不替换旧内容。</p><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}确认更新原订阅</button><button className="text-button" disabled={busy} onClick={() => setReview(false)}>返回修改</button></div>}
      {error && <p className="home-recovery" role="alert">{error}</p>}
      {success && <p className="home-recovery" role="status" data-guide-id={guideTargets.subscriptionSaved}>{success}</p>}
    </section>
  </div>;
}
