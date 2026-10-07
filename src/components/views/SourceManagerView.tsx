import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, FileUp, Globe2, Link2, Pencil, Plus, RefreshCw, ShieldAlert, Trash2, UploadCloud } from "lucide-react";
import { api } from "../../api";
import { guideTargets } from "../../guides/registry";
import type { NodeSource } from "../../shared/domain";
import { sourceErrorAdvice } from "../../shared/subscriptionStatus";
import { ConfirmDialog, Drawer } from "../Dialog";

type SourceDraft = {
  id?: string;
  name: string;
  kind: NodeSource["kind"];
  url: string;
  format: NodeSource["format"];
  enabled: boolean;
  intervalMinutes: number;
  userAgent: string;
  skipCertVerify: boolean;
  content: string;
};

const emptySource = (): SourceDraft => ({
  name: "我的订阅",
  kind: "remote-url",
  url: "",
  format: "auto",
  enabled: true,
  intervalMinutes: 360,
  userAgent: "",
  skipCertVerify: false,
  content: "",
});

function sourceDraft(source: NodeSource): SourceDraft {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url || "",
    format: source.format,
    enabled: source.enabled,
    intervalMinutes: source.intervalMinutes,
    userAgent: source.userAgent || "",
    skipCertVerify: source.skipCertVerify,
    content: "",
  };
}

function sourceTypeLabel(kind: NodeSource["kind"]) {
  if (kind === "remote-url") return "远程订阅";
  if (kind === "share-links") return "分享链接";
  if (kind === "file") return "配置文件";
  return "手动来源";
}

function intervalLabel(minutes: number) {
  if (!minutes) return "手动刷新";
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  return `${minutes / 60} 小时`;
}

export function SourceManagerView({ onProjectReload, onMessage }: { onProjectReload: () => Promise<void>; onMessage: (message: string) => void }) {
  const [items, setItems] = useState<NodeSource[]>([]);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [deleting, setDeleting] = useState<NodeSource | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [diagnosing, setDiagnosing] = useState("");
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});

  async function diagnose(item: NodeSource) {
    setDiagnosing(item.id);
    try { const result = await api.diagnoseSource(item.id); setDiagnostics((current) => ({ ...current, [item.id]: [...result.events.map((event) => `${event.profile || event.stage}：${event.message}${event.address ? ` · ${event.address}` : ""}`), result.advice].join("\n") })); }
    catch (error) { onMessage((error as Error).message); }
    finally { setDiagnosing(""); }
  }
  const [preview, setPreview] = useState<{ count: number; warnings: string[] } | null>(null);

  async function load() {
    try { setItems(await api.listNodeSources()); }
    catch (error) { onMessage(error instanceof Error ? error.message : "来源加载失败"); }
  }

  useEffect(() => { void load(); }, []);

  async function previewContent() {
    if (!draft?.content.trim()) return;
    try {
      const result = await api.parseContent(draft.content, draft.format);
      setPreview({ count: result.nodes.length || result.config?.proxies.length || 0, warnings: result.warnings });
    } catch (error) {
      setPreview(null);
      onMessage(error instanceof Error ? error.message : "内容解析失败");
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        kind: draft.kind,
        url: draft.url.trim() || undefined,
        format: draft.format,
        enabled: draft.enabled,
        intervalMinutes: draft.kind === "remote-url" ? draft.intervalMinutes : 0,
        userAgent: draft.kind === "remote-url" ? draft.userAgent.trim() || undefined : undefined,
        skipCertVerify: draft.kind === "remote-url" && draft.skipCertVerify,
      };
      let saved = draft.id ? await api.updateNodeSource(draft.id, payload) : await api.createNodeSource(payload);
      let importedCount = 0;
      let warnings = 0;
      let synchronized = false;
      try {
        if (draft.content.trim() && ["file", "share-links"].includes(saved.kind)) {
          const result = await api.importNodeSource(saved.id, draft.content);
          saved = result.source;
          importedCount = result.nodes.length;
          warnings = result.warnings.length;
          synchronized = Boolean(draft.id);
        } else if (!draft.id && saved.kind === "remote-url" && saved.url && saved.enabled) {
          const result = await api.refreshNodeSource(saved.id);
          saved = result.source;
          importedCount = result.nodes.length;
          warnings = result.warnings.length;
          synchronized = Boolean(draft.id);
        }
      } catch (error) {
        setDraft(null);
        setPreview(null);
        await load();
        onMessage(`来源已保存，但首次导入失败：${error instanceof Error ? error.message : "请稍后手动同步"}`);
        return;
      }
      if (synchronized) await onProjectReload();
      setItems((current) => draft.id ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setDraft(null);
      setPreview(null);
      onMessage(importedCount ? `来源已保存，导入 ${importedCount} 个节点${warnings ? `，${warnings} 条内容未识别` : ""}` : "来源已保存");
    } catch (error) { onMessage(error instanceof Error ? error.message : "来源保存失败"); }
    finally { setSaving(false); }
  }

  async function refresh(item: NodeSource) {
    if (!item.url || !item.enabled) return;
    setRefreshing(item.id);
    try {
      const result = await api.refreshNodeSource(item.id);
      await onProjectReload();
      setItems((current) => current.map((value) => value.id === result.source.id ? result.source : value));
      onMessage(`已同步 ${result.nodes.length} 个节点${result.warnings.length ? `，${result.warnings.length} 条内容未识别` : ""}`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "来源刷新失败");
      await load();
    } finally { setRefreshing(null); }
  }

  return <>
    <div className="view-toolbar source-manager-toolbar" data-guide-id={guideTargets.sourceToolbar}>
      <div>
        <div className="summary-inline"><span><strong>{items.length}</strong> 个来源</span><i /><span><strong>{items.reduce((sum, item) => sum + item.nodeCount, 0)}</strong> 个节点</span></div>
        <p className="toolbar-description">订阅 URL、配置文件和节点分享链接统一在这里管理。</p>
      </div>
      <div className="row-actions">
        <button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />刷新</button>
        <button className="primary-button" data-guide-id={guideTargets.sourceAdd} onClick={() => { setDraft(emptySource()); setPreview(null); }}><Plus size={17} />添加来源</button>
      </div>
    </div>

    {items.length ? <div className="source-card-grid" data-guide-id={guideTargets.sourceList}>{items.map((item) =>
      <article className={`source-card${item.lastError ? " has-error" : ""}`} key={item.id}>
        <header>
          <span className="source-card-icon">{item.kind === "remote-url" ? <Globe2 size={20} /> : item.kind === "file" ? <FileUp size={20} /> : <Link2 size={20} />}</span>
          <div><h2>{item.name}</h2><span>{sourceTypeLabel(item.kind)} · {item.format === "auto" ? "自动识别" : item.format}</span></div>
          <span className={item.enabled ? "status-dot active" : "status-dot"}>{item.enabled ? "运行中" : "已停用"}</span>
        </header>
        <div className="source-card-address" title={item.url || "本地导入来源"}>{item.url || "本地导入来源"}</div>
        <div className="source-card-metrics">
          <span><strong>{item.nodeCount}</strong><small>节点</small></span>
          <span><strong>{intervalLabel(item.intervalMinutes)}</strong><small>同步周期</small></span>
          <span><strong>{item.lastRequestProfile || "-"}</strong><small>请求模式</small></span>
        </div>
        {item.lastError ? <div className="source-recovery"><div className="source-card-error"><ShieldAlert size={15} /><span title={item.lastError}>{item.lastError}</span></div><p>{sourceErrorAdvice(item.lastError)}</p><small>{item.lastUpdatedAt ? `最近成功：${new Date(item.lastUpdatedAt).toLocaleString("zh-CN")}` : "尚未成功导入"}。本次失败不会清空已导入节点或已发布内容。</small></div> : <div className="source-card-success"><CheckCircle2 size={15} />{item.lastUpdatedAt ? `最近同步 ${new Date(item.lastUpdatedAt).toLocaleString("zh-CN")}` : "等待首次同步"}</div>}
        {diagnostics[item.id] && <details open className="source-diagnostics"><summary>诊断结果（订阅路径与 Token 已隐藏）</summary>{diagnostics[item.id]}</details>}
        <footer>
          {item.url && <button className="secondary-button compact-button" disabled={!!diagnosing} onClick={() => void diagnose(item)}>{diagnosing === item.id ? "诊断中…" : "诊断连接"}</button>}
          <button className="secondary-button compact-button" disabled={!item.url || !item.enabled || refreshing === item.id} onClick={() => void refresh(item)}>{refreshing === item.id ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />}同步</button>
          <button className="secondary-button compact-button source-edit-action" onClick={() => { setDraft(sourceDraft(item)); setPreview(null); }} aria-label={`编辑 ${item.name}`}><Pencil size={15} />编辑</button>
          <button className="secondary-button compact-button danger-outline source-delete-action" onClick={() => setDeleting(item)} aria-label={`删除 ${item.name}`}><Trash2 size={15} />删除</button>
        </footer>
      </article>)}</div> : <div className="empty-state featured-empty" data-guide-id={guideTargets.sourceList}>
      <div className="empty-state-icon"><UploadCloud size={25} /></div><h2>建立第一个节点来源</h2><p>可粘贴订阅 URL、批量分享链接，或者上传 Mihomo 与 sing-box 配置。</p><button className="primary-button" onClick={() => setDraft(emptySource())}><Plus size={17} />添加来源</button>
    </div>}

    <Drawer open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? `编辑来源：${draft.name}` : "添加节点来源"} footer={<><button className="secondary-button" onClick={() => setDraft(null)}>取消</button><button className="primary-button" disabled={saving || !draft?.name.trim() || (draft.kind === "remote-url" && !draft.url.trim()) || (["file", "share-links"].includes(draft?.kind || "") && !draft?.id && !draft?.content.trim())} onClick={() => void save()}>{saving ? <RefreshCw className="spin" size={16} /> : <CheckCircle2 size={16} />}保存来源</button></>}>
      {draft && <div className="form-grid">
        <label className="span-2">来源名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>来源类型<select value={draft.kind} onChange={(event) => { setDraft({ ...draft, kind: event.target.value as NodeSource["kind"], url: event.target.value === "remote-url" ? draft.url : "", intervalMinutes: event.target.value === "remote-url" ? draft.intervalMinutes || 360 : 0 }); setPreview(null); }}><option value="remote-url">远程订阅 URL</option><option value="share-links">节点分享链接</option><option value="file">配置文件</option><option value="manual">手动来源</option></select></label>
        <label>内容格式<select value={draft.format} onChange={(event) => { setDraft({ ...draft, format: event.target.value as NodeSource["format"] }); setPreview(null); }}><option value="auto">自动识别</option><option value="links">分享链接 / Base64</option><option value="mihomo">Mihomo YAML</option><option value="sing-box">sing-box JSON</option></select></label>

        {draft.kind === "remote-url" && <>
          <label className="span-2">订阅 URL<input type="url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/subscribe" /></label>
          <label>自动同步<select value={draft.intervalMinutes} onChange={(event) => setDraft({ ...draft, intervalMinutes: Number(event.target.value) })}><option value={0}>仅手动</option><option value={30}>每 30 分钟</option><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={720}>每 12 小时</option><option value={1440}>每天</option></select></label>
          <label>自定义 User-Agent<input value={draft.userAgent} onChange={(event) => setDraft({ ...draft, userAgent: event.target.value })} placeholder="留空时自动兼容重试" /></label>
          <label className="toggle-row span-2"><span><strong>跳过 TLS 证书校验</strong><small>仅用于确认可信但证书配置异常的订阅服务</small></span><input type="checkbox" checked={draft.skipCertVerify} onChange={(event) => setDraft({ ...draft, skipCertVerify: event.target.checked })} /></label>
        </>}

        {["file", "share-links"].includes(draft.kind) && <>
          <label className="span-2 import-textarea">粘贴内容<textarea value={draft.content} onChange={(event) => { setDraft({ ...draft, content: event.target.value }); setPreview(null); }} placeholder={draft.kind === "share-links" ? "vless://...\nvmess://...\ntrojan://..." : "粘贴 YAML、JSON 或 Base64 订阅内容"} /></label>
          <label className="span-2 file-picker"><FileUp size={18} /><span><strong>也可以选择文件</strong><small>支持 YAML、JSON、TXT 和 CONF</small></span><input type="file" accept=".yaml,.yml,.json,.txt,.conf" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { setDraft({ ...draft, content: await file.text() }); setPreview(null); } }} /></label>
          <div className="span-2 preview-actions"><button className="secondary-button" disabled={!draft.content.trim()} onClick={() => void previewContent()}><Link2 size={16} />解析预览</button>{preview && <span className={preview.warnings.length ? "preview-summary warning" : "preview-summary"}>识别 {preview.count} 个节点{preview.warnings.length ? ` · ${preview.warnings.length} 条未识别` : ""}</span>}</div>
        </>}

        <label className="toggle-row span-2"><span><strong>启用来源</strong><small>停用后保留已导入节点，但不再自动同步</small></span><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
        <div className="form-hint span-2"><Clock3 size={16} />远程来源保存后会立即拉取；后续同步保留已引用节点的 ID、标签、备注和项目关系。</div>
      </div>}
    </Drawer>

    <ConfirmDialog open={!!deleting} title="删除节点来源" message={`确定删除“${deleting?.name}”吗？来源节点会保留在节点库中并转为手动节点。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; try { await api.deleteNodeSource(deleting.id); setItems((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); onMessage("来源已删除"); } catch (error) { onMessage(error instanceof Error ? error.message : "来源删除失败"); } }} />
  </>;
}
