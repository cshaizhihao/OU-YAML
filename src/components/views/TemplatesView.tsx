import { useEffect, useState } from "react";
import { BookOpen, Copy, FileText, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api";
import { ruleCatalog } from "../../shared/ruleCatalog";
import { ConfirmDialog, Drawer } from "../Dialog";

type Template = { id: string; name: string; description: string; targetFormat: string; content: unknown[]; builtin: boolean };
type TemplateDraft = { id?: string; name: string; description: string; targetFormat: "mihomo" | "sing-box"; content: string };
const blank: TemplateDraft = { name: "我的规则模板", description: "", targetFormat: "mihomo", content: "" };

function contentText(content: unknown[]) { return content.every((item) => typeof item === "string") ? content.join("\n") : JSON.stringify(content, null, 2); }
function parseContent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("模板内容必须是数组");
    return parsed;
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function TemplatesView({ onMessage }: { onMessage: (message: string) => void }) {
  const [items, setItems] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);

  async function load() {
    try { setItems(await api.listRuleTemplates()); }
    catch (error) { onMessage(error instanceof Error ? error.message : "模板加载失败"); }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!editing) return;
    try {
      const data = { name: editing.name.trim(), description: editing.description.trim(), targetFormat: editing.targetFormat, content: parseContent(editing.content) };
      if (editing.id) await api.updateRuleTemplate(editing.id, data);
      else await api.createRuleTemplate(data);
      setEditing(null); await load(); onMessage(editing.id ? "规则模板已更新" : "规则模板已创建");
    } catch (error) { onMessage(error instanceof Error ? error.message : "模板保存失败"); }
  }

  async function copy(item: Template) {
    try { await api.createRuleTemplate({ name: `${item.name} 副本`, description: item.description, targetFormat: item.targetFormat === "sing-box" ? "sing-box" : "mihomo", content: item.content }); await load(); onMessage("模板已复制"); }
    catch (error) { onMessage(error instanceof Error ? error.message : "模板复制失败"); }
  }

  return <>
    <div className="view-toolbar"><div className="summary-inline"><span><strong>{items.length}</strong> 个模板</span><i /><span><strong>{items.filter((item) => item.builtin).length}</strong> 个内置</span></div><div className="row-actions"><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); await load(); setBusy(false); }}><RefreshCw size={16} className={busy ? "spin" : ""} />刷新</button><button className="primary-button" onClick={() => setEditing({ ...blank })}><Plus size={17} />新建模板</button></div></div>
    {items.length ? <div className="grid-2">{items.map((item) => <article className="panel-card template-card" key={item.id}><div className="template-card-icon"><BookOpen size={22} /></div><div className="template-card-body"><div className="template-card-top"><span className="eyebrow">{item.builtin ? "内置模板" : "我的模板"}</span><span className="type-badge">{item.targetFormat}</span></div><h2>{item.name}</h2><p>{item.description || "适用于生成订阅的规则模板。"}</p><div className="template-card-meta"><span><FileText size={15} />{item.content.length} 条规则</span><div className="row-actions"><button className="secondary-button compact-button" onClick={() => void copy(item)}><Copy size={15} />复制</button>{!item.builtin && <><button className="secondary-button compact-button template-edit-action" onClick={() => setEditing({ id: item.id, name: item.name, description: item.description, targetFormat: item.targetFormat === "sing-box" ? "sing-box" : "mihomo", content: contentText(item.content) })} aria-label={`编辑 ${item.name}`}><Pencil size={15} />编辑</button><button className="secondary-button compact-button danger-outline template-delete-action" onClick={() => setDeleting(item)} aria-label={`删除 ${item.name}`}><Trash2 size={15} />删除</button></>}</div></div></div></article>)}</div> : <div className="empty-state"><div className="empty-state-icon"><Sparkles size={24} /></div><h2>还没有规则模板</h2><p>模板可以在生成订阅时复用规则和目标策略组。</p></div>}
    <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "编辑规则模板" : "新建规则模板"} footer={<><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={!editing?.name.trim()} onClick={() => void save()}>保存模板</button></>}>
      {editing && <div className="form-grid"><label className="span-2">模板名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>输出格式<select value={editing.targetFormat} onChange={(event) => setEditing({ ...editing, targetFormat: event.target.value as TemplateDraft["targetFormat"] })}><option value="mihomo">Mihomo YAML</option><option value="sing-box">sing-box JSON</option></select></label><label>说明<input value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label className="span-2 import-textarea">规则内容<textarea value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} placeholder="DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,DIRECT" /></label><div className="form-hint span-2">每行一条标准英文规则；不熟悉代码时建议先在“设置分流”的新手模式中创建。</div><details className="rule-reference span-2"><summary>查看英文规则中文对照</summary><div>{ruleCatalog.map((item) => <span key={item.type}><code>{item.type}</code><strong>{item.label}</strong><small>{item.description}</small></span>)}</div></details></div>}
    </Drawer>
    <ConfirmDialog open={!!deleting} title="删除规则模板" message={`确定删除“${deleting?.name}”吗？删除后不可恢复。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; try { await api.deleteRuleTemplate(deleting.id); setItems((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); onMessage("模板已删除"); } catch (error) { onMessage(error instanceof Error ? error.message : "模板删除失败"); } }} />
  </>;
}
