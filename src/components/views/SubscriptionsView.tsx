import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Link2, LoaderCircle, Pencil, Plus, RefreshCw, Rss, Settings2, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { MihomoConfig, Project, Subscription } from "../../shared/types";
import { ConfirmDialog, Drawer } from "../Dialog";

const emptySubscription = (): Subscription => ({ id: "", projectId: "", name: "新订阅", url: "", format: "auto", intervalMinutes: 0, nodeCount: 0, createdAt: "" });
const displayHost = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };

export function SubscriptionsView({ project, onConfig, onMessage }: { project: Project; onConfig: (config: MihomoConfig) => void; onMessage: (message: string) => void }) {
  const [items, setItems] = useState<Subscription[]>([]);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [deleting, setDeleting] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quickUrl, setQuickUrl] = useState("");
  const load = () => api.listSubscriptions(project.id).then(setItems).catch((error) => onMessage(error.message));
  useEffect(() => { load(); }, [project.id]);
  async function save(subscription: Subscription) {
    setBusy(subscription.id || "new");
    try {
      if (subscription.id) {
        const saved = await api.updateSubscription(project.id, subscription.id, subscription); setItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      } else {
        const result = await api.createSubscription(project.id, subscription);
        const payload = "subscription" in result ? result : { subscription: result };
        setItems((current) => [payload.subscription, ...current]); if (payload.config) onConfig(payload.config);
        onMessage(payload.error || `已导入 ${payload.subscription.nodeCount} 个节点`);
      }
      setEditing(null);
      return true;
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存订阅失败"); return false; }
    finally { setBusy(null); }
  }
  async function refresh(subscription: Subscription) {
    setBusy(subscription.id);
    try { const result = await api.refreshSubscription(project.id, subscription.id); setItems((current) => current.map((item) => item.id === result.subscription.id ? result.subscription : item)); onConfig(result.config); onMessage(`已更新 ${result.subscription.nodeCount} 个节点`); }
    catch (error) { onMessage(error instanceof Error ? error.message : "订阅更新失败"); load(); }
    finally { setBusy(null); }
  }
  async function quickAdd(event: FormEvent) {
    event.preventDefault();
    const draft = emptySubscription();
    draft.url = quickUrl.trim();
    try { draft.name = new URL(draft.url).hostname || "我的订阅"; } catch { draft.name = "我的订阅"; }
    if (await save(draft)) setQuickUrl("");
  }
  return <>
    <div className="view-toolbar"><div className="summary-inline"><span><strong>{items.length}</strong> 个订阅</span><i /><span><strong>{items.reduce((sum, item) => sum + item.nodeCount, 0)}</strong> 个节点</span></div><button className="primary-button" onClick={() => setEditing(emptySubscription())}><Plus size={17} />添加订阅 URL</button></div>
    {items.length ? <div className="subscription-list">{items.map((item) => <article className="subscription-row" key={item.id}><span className="subscription-icon"><Rss size={20} /></span><div className="subscription-main"><h2>{item.name}</h2><span>{displayHost(item.url)}</span></div><span className="type-badge">{item.format === "auto" ? "自动识别" : item.format}</span><div className="subscription-stats"><strong>{item.nodeCount}</strong><span>节点</span></div><div className={item.lastError ? "subscription-status error" : "subscription-status"}>{item.lastError ? <><AlertTriangle size={15} /><span title={item.lastError}>更新失败</span></> : item.lastUpdatedAt ? <><CheckCircle2 size={15} /><span>{new Date(item.lastUpdatedAt).toLocaleString("zh-CN")}</span></> : <><Clock3 size={15} /><span>等待更新</span></>}</div><div className="row-actions"><button className="secondary-button compact-button" disabled={busy === item.id} onClick={() => refresh(item)}>{busy === item.id ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}更新</button><button className="icon-button compact" onClick={() => setEditing({ ...item })} aria-label={`编辑 ${item.name}`}><Pencil size={16} /></button><button className="icon-button compact danger" onClick={() => setDeleting(item)} aria-label={`删除 ${item.name}`}><Trash2 size={16} /></button></div></article>)}</div> : <div className="subscription-empty"><span className="subscription-empty-icon"><Rss size={24} /></span><div><h2>添加第一个订阅</h2><form onSubmit={quickAdd}><label>订阅 URL<input type="url" required value={quickUrl} onChange={(event) => setQuickUrl(event.target.value)} placeholder="https://example.com/subscription" /></label><button className="primary-button" disabled={!!busy || !quickUrl.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}导入节点</button></form><button className="text-button" onClick={() => setEditing(emptySubscription())}><Settings2 size={15} />格式与自动更新设置</button></div></div>}
    <SubscriptionEditor key={editing?.id || (editing ? "new" : "closed")} subscription={editing} busy={!!busy} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除订阅" message={`确定删除“${deleting?.name}”及其导入的节点吗？删除前会自动创建快照。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; try { await api.deleteSubscription(project.id, deleting.id, true); setDeleting(null); await load(); const updated = await api.getProject(project.id); onConfig(updated.config); onMessage("订阅已删除"); } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); } }} />
  </>;
}

function SubscriptionEditor({ subscription, busy, onClose, onSave }: { subscription: Subscription | null; busy: boolean; onClose: () => void; onSave: (value: Subscription) => void }) {
  const [draft, setDraft] = useState(subscription);
  if (!draft) return null;
  return <Drawer title={draft.id ? `编辑 ${draft.name}` : "添加订阅"} open onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !draft.name.trim() || !draft.url.trim()} onClick={() => onSave(draft)}>{busy && <LoaderCircle className="spin" size={17} />}保存订阅</button></>}><div className="form-grid"><label className="span-2">订阅名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="span-2">订阅地址<input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/subscription" /></label><label>内容格式<select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as Subscription["format"] })}><option value="auto">自动识别</option><option value="links">分享链接</option><option value="mihomo">Mihomo YAML</option><option value="sing-box">sing-box JSON</option></select></label><label>自动更新<select value={draft.intervalMinutes} onChange={(event) => setDraft({ ...draft, intervalMinutes: Number(event.target.value) })}><option value={0}>手动</option><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={720}>每 12 小时</option><option value={1440}>每天</option></select></label></div></Drawer>;
}
