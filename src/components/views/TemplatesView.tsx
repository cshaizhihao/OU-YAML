import { useEffect, useState } from "react";
import { BookOpen, Copy, FileText, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../../api";

type Template = { id: string; name: string; description: string; targetFormat: string; content: unknown[]; builtin: boolean };
export function TemplatesView({ onMessage }: { onMessage: (message: string) => void }) {
  const [items, setItems] = useState<Template[]>([]); const [busy, setBusy] = useState(false);
  const load = () => api.listRuleTemplates().then(setItems).catch(error => onMessage(error instanceof Error ? error.message : "模板加载失败"));
  useEffect(() => { load(); }, []);
  async function copy(item: Template) { await api.createRuleTemplate({ name: `${item.name} 副本`, description: item.description, targetFormat: item.targetFormat === "sing-box" ? "sing-box" : "mihomo", content: item.content }); await load(); onMessage("模板已复制"); }
  return <><div className="view-toolbar"><div className="summary-inline"><span><strong>{items.length}</strong> 个模板</span><i/><span><strong>{items.filter(item => item.builtin).length}</strong> 个内置</span></div><div className="row-actions"><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); await load(); setBusy(false); }}><RefreshCw size={16} className={busy ? "spin" : ""}/>刷新</button><button className="primary-button" onClick={() => onMessage("模板编辑器将在下一轮继续增强") }><Plus size={17}/>新建模板</button></div></div>{items.length ? <div className="grid-2">{items.map(item => <article className="panel-card template-card" key={item.id}><div className="template-card-icon"><BookOpen size={22}/></div><div className="template-card-body"><div className="template-card-top"><span className="eyebrow">{item.builtin ? "BUILT-IN" : "MY TEMPLATE"}</span><span className="type-badge">{item.targetFormat}</span></div><h2>{item.name}</h2><p>{item.description || "适用于生成订阅的规则模板。"}</p><div className="template-card-meta"><span><FileText size={15}/>{item.content.length} 条规则</span><button className="secondary-button compact-button" onClick={() => copy(item)}><Copy size={15}/>复制</button></div></div></article>)}</div> : <div className="empty-state"><div><Sparkles size={24}/></div><h2>还没有规则模板</h2><p>模板可以在生成订阅时复用规则和目标策略组。</p></div>}</>;
}
