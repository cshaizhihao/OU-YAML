import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Info, LoaderCircle, RotateCcw, X } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode } from "../../shared/domain";
import type { MihomoConfig } from "../../shared/types";
import type { SubscriptionEditorState, SubscriptionEditorTab } from "../../shared/subscriptionEditor";
import { previewExport } from "../../shared/exportConfig";
import { refreshProfileConfig } from "../../shared/publication";
import { guideTargets } from "../../guides/registry";
import { Drawer } from "../Dialog";
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
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const busy = saving || loading;
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dirty = Boolean(original?.subscription.id === id && config && (name !== original.subscription.name || JSON.stringify(config) !== JSON.stringify(original.config) || selected.size !== config.proxies.length || config.proxies.some((node) => !selected.has(node.id))));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.allSettled([api.getSubscriptionEditor(id), api.listManagedNodes()]).then(([editorResult, managedResult]) => {
      if (cancelled) return;
      if (editorResult.status === "rejected") {
        const reason = editorResult.reason;
        setError(`订阅详情请求失败：${reason instanceof Error ? reason.message : "请稍后重试"}。已有编辑草稿会保留。`);
        return;
      }
      if (managedResult.status === "rejected") {
        const reason = managedResult.reason;
        setError(`节点库请求失败：${reason instanceof Error ? reason.message : "请稍后重试"}。已有编辑草稿会保留。`);
        return;
      }
      const editor = editorResult.value;
      const managed = managedResult.value;
      setOriginal(editor); setConfig(editor.config); setName(editor.subscription.name); setNodes(managed.filter((node) => node.enabled)); setSelected(new Set(editor.config.proxies.map((node) => node.id))); setReview(false); setSuccess("");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, attempt]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    const beforeNavigate = (event: Event) => { if (saving || (dirty && !window.confirm("这份订阅还有未发布的修改，离开会丢弃。确定离开吗？"))) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("ou-yaml:before-navigate", beforeNavigate);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("ou-yaml:before-navigate", beforeNavigate); };
  }, [dirty, saving]);

  function change(next: MihomoConfig) { setConfig(next); setReview(false); setSuccess(""); }
  function prepare() {
    if (!config || !original || busy) return;
    const rendered = previewExport(config, original.subscription.targetFormat);
    const errors = rendered.issues.filter((issue) => issue.level === "error");
    if (!config.proxies.length || errors.length) { setError(errors.map((issue) => issue.message).join("；") || "请至少选择一个节点"); return; }
    setError(""); setReview(true); setSuccess("");
  }
  async function save() {
    if (!original || !config || busy) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const updated = await api.saveSubscriptionEditor(id, { name: name.trim(), config, revision: original.revision });
      setOriginal(updated); setConfig(updated.config); setName(updated.subscription.name); setSelected(new Set(updated.config.proxies.map((node) => node.id))); setReview(false);
      setSuccess(`已更新原订阅 · 内容 v${updated.subscription.version}。客户端地址不变，请在客户端刷新订阅。${updated.kernelChecked ? "" : "当前服务器未提供内核，仅完成结构校验。"}`);
      window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: "subscription-updated" }));
    } catch (reason) { setError(`更新未完成：${reason instanceof Error ? reason.message : "请稍后重试"}。编辑草稿已保留，可重试或重新载入核对已保存内容。`); setReview(false); }
    finally { setSaving(false); }
  }
  function reload() {
    if (busy) return;
    if (dirty && !window.confirm("重新载入会丢弃未发布修改，确定继续吗？")) return;
    setLoading(true); setError(""); setReview(false); setSuccess("");
    setAttempt((value) => value + 1);
  }

  function applyNodes() {
    if (!config || !selected.size) return;
    try {
      const existing = new Map(config.proxies.map((node) => [node.id, node]));
      const choices = [...config.proxies.filter((node) => !nodes.some((managed) => managed.id === node.id)), ...nodes].filter((node) => selected.has(node.id)).map((node) => existing.get(node.id) || node);
      change(refreshProfileConfig(config, choices, true));
      setError("");
      setTab("groups");
    } catch (reason) { setError((reason as Error).message); }
  }

  if (!original || !config || original.subscription.id !== id) return <section className="panel-card"><button className="text-button" onClick={onBack}><ArrowLeft size={16} />返回我的订阅</button>{error ? <><p role="alert">{error}</p><button className="secondary-button" disabled={busy} onClick={reload}>重新载入</button></> : <p><LoaderCircle className="spin" size={18} /> 正在打开这份订阅…</p>}</section>;
  const nodeSelectionPending = selected.size !== config.proxies.length || config.proxies.some((node) => !selected.has(node.id));
  const available = [...config.proxies.filter((node) => !nodes.some((managed) => managed.id === node.id)), ...nodes].filter((node) => `${node.name} ${node.server}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="subscription-editor">
    <header className="editor-heading">
      <button className="icon-button" disabled={busy} onClick={onBack} aria-label="返回我的订阅" title="返回我的订阅"><ArrowLeft size={18} /></button>
      <label className="editor-name"><span>订阅名称</span><input value={name} title={name} maxLength={120} disabled={busy} onChange={(event) => { setName(event.target.value); setReview(false); setSuccess(""); }} /></label>
      <button className="icon-button" disabled={busy} onClick={reload} aria-label="重新载入" title="重新载入已保存的订阅"><RotateCcw size={17} /></button>
      <button className="icon-button" onClick={() => setShowDetails(true)} aria-label="订阅信息" title="版本、格式与有效期"><Info size={18} /></button>
    </header>
    <nav className="section-tabs" aria-label="订阅编辑步骤">{([{ id: "nodes", name: "1. 选择节点" }, { id: "groups", name: "2. 编辑分组" }, { id: "rules", name: "3. 编辑分流" }] as const).map((item) => <button key={item.id} disabled={busy} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.name}</button>)}</nav>
    <div className={`subscription-editor-body${tab === "groups" ? " editing-groups" : ""}`} inert={busy}>
      {tab === "nodes" && <section className="editor-node-selection"><header><h2>选择这份订阅的节点</h2><span>已选 {selected.size} 个</span></header><p>勾选后点击底部应用；新增节点默认加入第一个代理组。</p><input aria-label="筛选订阅节点" placeholder="搜索节点名称或服务器" value={query} onChange={(event) => { setQuery(event.target.value); setNodeLimit(100); }} /><div className="editor-node-list">{available.slice(0, nodeLimit).map((node) => <label key={node.id}><input type="checkbox" checked={selected.has(node.id)} onChange={(event) => { setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(node.id) : next.delete(node.id); return next; }); setReview(false); setSuccess(""); }} /><span><strong>{node.name}</strong><small>{node.type.toUpperCase()} · {node.server}:{node.port}</small></span></label>)}</div>{!available.length && <p className="editor-node-empty">{query ? "没有匹配的节点，试试其他名称或地址。" : "暂无可选节点，请先到「订阅来源」导入。"}</p>}{available.length > nodeLimit && <button className="text-button" onClick={() => setNodeLimit(nodeLimit + 100)}>再显示 100 个节点</button>}</section>}
      {tab === "groups" && <GroupsView config={config} onChange={change} onMessage={onMessage} />}
      {tab === "rules" && <section data-guide-id={guideTargets.subscriptionRules}><RulesView config={config} onChange={change} /></section>}
    </div>
    {(error || success) && <div className={`editor-feedback${error ? " error" : " success"}`}><p role={error ? "alert" : "status"} data-guide-id={!error ? guideTargets.subscriptionSaved : undefined}>{error || success}</p><button className="icon-button compact" aria-label="关闭编辑提示" onClick={() => { setError(""); setSuccess(""); }}><X size={16} /></button></div>}
    <footer className="editor-publish" data-guide-id={guideTargets.subscriptionSave}>
      <div className="editor-publish-status" aria-live="polite"><strong>{loading ? "正在重新载入…" : saving ? "正在校验并更新…" : nodeSelectionPending ? "节点选择尚未应用" : dirty ? "有未发布修改" : "与已保存配置一致"}</strong><small>确认后更新，原地址不变</small></div>
      {nodeSelectionPending ? <button className="primary-button" disabled={busy || !selected.size} onClick={applyNodes} aria-label="应用节点选择，继续编辑分组">应用节点选择</button> : <button className="primary-button" disabled={busy || !name.trim()} onClick={prepare}>{busy && <LoaderCircle size={16} className="spin" />}检查并更新原订阅</button>}
    </footer>
    <Drawer title="确认更新原订阅" open={review} size="compact" closeDisabled={busy} onClose={() => setReview(false)} footer={<><button className="secondary-button" disabled={busy} onClick={() => setReview(false)}>返回修改</button><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}确认更新原订阅</button></>}>
      <section className="editor-review" role="region" aria-label="更新原订阅确认"><h3>{name.trim()}</h3><dl>{[{ label: "节点", before: original.config.proxies.length, after: config.proxies.length }, { label: "代理组", before: original.config.proxyGroups.length, after: config.proxyGroups.length }, { label: "规则", before: original.config.rules.length, after: config.rules.length }].map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.before} → <strong>{item.after}</strong></dd></div>)}</dl><p>原地址与有效期保持不变；校验失败不替换旧内容。</p>{original.subscription.expiresAt && <p>有效期至 {new Date(original.subscription.expiresAt).toLocaleString("zh-CN")}</p>}</section>
    </Drawer>
    <Drawer title="订阅信息" open={showDetails} size="compact" onClose={() => setShowDetails(false)}>
      <dl className="editor-details"><div><dt>已发布名称</dt><dd>{original.subscription.name}</dd></div><div><dt>内容版本</dt><dd>v{original.subscription.version}</dd></div><div><dt>配置格式</dt><dd>{original.subscription.targetFormat === "sing-box" ? "sing-box · JSON" : "Mihomo · YAML"}</dd></div><div><dt>链接有效期</dt><dd>{original.subscription.expiresAt ? new Date(original.subscription.expiresAt).toLocaleString("zh-CN") : "未设置到期时间"}</dd></div></dl><p className="form-hint">此页面的修改不会自动发布。检查并确认后更新原订阅，不影响其他订阅。</p>
    </Drawer>
  </div>;
}
