import { useEffect, useState } from "react";
import { CheckCircle2, FileUp, Link2, Pencil, Plus, RefreshCw, Rss, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { NodeSource } from "../../shared/domain";
import { ConfirmDialog, Drawer } from "../Dialog";

type SourceDraft = { id?: string; name: string; kind: NodeSource["kind"]; url: string; format: NodeSource["format"]; enabled: boolean; content?: string };
const empty: SourceDraft = { name: "我的订阅", kind: "remote-url", url: "", format: "auto", enabled: true };

export function SourceManagerView({ onMessage }: { onMessage: (message: string) => void }) {
  const [items, setItems] = useState<NodeSource[]>([]);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [deleting, setDeleting] = useState<NodeSource | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  async function load() {
    try { setItems(await api.listNodeSources()); }
    catch (error) { onMessage(error instanceof Error ? error.message : "来源加载失败"); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!draft) return;
    try {
      const saved = draft.id ? await api.updateNodeSource(draft.id, draft) : await api.createNodeSource(draft);
      let finalSource = saved;
      let importedCount = 0;
      if (draft.content && (saved.kind === "file" || saved.kind === "share-links")) {
        const result = await api.importNodeSource(saved.id, draft.content);
        finalSource = result.source;
        importedCount = result.nodes.length;
      }
      setItems((current) => draft.id ? current.map((item) => item.id === finalSource.id ? finalSource : item) : [finalSource, ...current]);
      setDraft(null);
      onMessage(importedCount ? `来源已保存并导入 ${importedCount} 个节点` : draft.id ? "订阅来源已更新" : "订阅来源已保存");
    } catch (error) { onMessage(error instanceof Error ? error.message : "来源保存失败"); }
  }

  async function refresh(item: NodeSource) {
    if (!item.url || !item.enabled) return;
    setRefreshing(item.id);
    try {
      const result = await api.refreshNodeSource(item.id);
      setItems((current) => current.map((value) => value.id === result.source.id ? result.source : value));
      onMessage(`已刷新 ${result.nodes.length} 个节点${result.warnings.length ? `，${result.warnings.length} 条警告` : ""}`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "来源刷新失败"); await load(); }
    finally { setRefreshing(null); }
  }

  function edit(item: NodeSource) { setDraft({ id: item.id, name: item.name, kind: item.kind, url: item.url || "", format: item.format, enabled: item.enabled }); }

  return <>
    <div className="view-toolbar"><div className="summary-inline"><span><strong>{items.length}</strong> 个来源</span><i /><span><strong>{items.reduce((sum, item) => sum + item.nodeCount, 0)}</strong> 个节点</span></div><div className="row-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button><button className="primary-button" onClick={() => setDraft({ ...empty })}><Plus size={17} />添加来源</button></div></div>
    {items.length ? <div className="subscription-list">{items.map((item) => <article className="subscription-row" key={item.id}><span className="subscription-icon"><Rss size={20} /></span><div className="subscription-main"><h2>{item.name}</h2><span>{item.url || "手动来源"}</span>{item.lastError && <small className="subscription-error-detail" title={item.lastError}>{item.lastError}</small>}</div><span className="type-badge">{item.format}</span><div className="subscription-stats"><strong>{item.nodeCount}</strong><span>节点</span></div><div className="subscription-status">{item.lastError ? <><Trash2 size={15} /><span>刷新失败</span></> : <><CheckCircle2 size={15} /><span>{item.enabled ? "已启用" : "已停用"}</span></>}</div><div className="row-actions"><button className="icon-button compact" disabled={!item.url || !item.enabled || refreshing === item.id} onClick={() => void refresh(item)} aria-label={`刷新 ${item.name}`} title={item.url && item.enabled ? "刷新来源" : "来源未启用或没有远程地址"}>{refreshing === item.id ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}</button><button className="icon-button compact" onClick={() => edit(item)} aria-label={`编辑 ${item.name}`}><Pencil size={16} /></button><button className="icon-button compact danger" onClick={() => setDeleting(item)} aria-label={`删除 ${item.name}`}><Trash2 size={16} /></button></div></article>)}</div> : <div className="empty-state"><div><Link2 size={24} /></div><h2>还没有订阅来源</h2><p>添加一个远程 URL，或者先建立手动节点来源。</p><button className="primary-button" onClick={() => setDraft({ ...empty })}><Plus size={17} />添加来源</button></div>}
    <Drawer open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `编辑来源：${draft.name}` : "添加订阅来源"} footer={<><button className="secondary-button" onClick={() => setDraft(null)}>取消</button><button className="primary-button" disabled={!draft?.name.trim() || (draft.kind === "remote-url" && !draft.url.trim())} onClick={() => void save()}>保存来源</button></>}>
      {draft && <div className="form-grid"><label className="span-2">来源名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>来源类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as NodeSource["kind"], url: event.target.value === "remote-url" ? draft.url : "" })}><option value="remote-url">远程订阅</option><option value="file">配置文件</option><option value="share-links">分享链接</option><option value="manual">手动节点</option></select></label><label>格式<select value={draft.format} onChange={(event) => setDraft({ ...draft, format: event.target.value as NodeSource["format"] })}><option value="auto">自动识别</option><option value="links">分享链接</option><option value="mihomo">Mihomo YAML</option><option value="sing-box">sing-box JSON</option></select></label>{draft.kind === "remote-url" && <label className="span-2">订阅 URL<input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/subscribe" /></label>}{(draft.kind === "file" || draft.kind === "share-links") && <label className="span-2">上传内容<input type="file" accept={draft.kind === "file" ? ".yaml,.yml,.json,.txt" : ".txt,.conf"} onChange={async (event) => { const file = event.target.files?.[0]; if (file) setDraft({ ...draft, content: await file.text() }); }} /><small className="form-hint"><FileUp size={16} />选择文件后，保存时会解析并替换此来源的节点。</small></label>}<label className="toggle-row span-2"><span><strong>启用自动刷新</strong><small>停用后保留节点，但不会继续抓取来源</small></span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label><div className="form-hint span-2"><FileUp size={16} />远程来源通过 URL 刷新，文件和分享链接来源通过上传导入。</div></div>}
    </Drawer>
    <ConfirmDialog open={!!deleting} title="删除订阅来源" message={`确定删除“${deleting?.name}”吗？来源节点会保留在节点池中。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; try { await api.deleteNodeSource(deleting.id); setItems((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); onMessage("来源已删除"); } catch (error) { onMessage(error instanceof Error ? error.message : "来源删除失败"); } }} />
  </>;
}
