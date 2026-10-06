import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Database, FilePlus2, Link2, Network, Pencil, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode, NodeSource } from "../../shared/domain";
import { Drawer, ConfirmDialog } from "../Dialog";

const blank = { name: "新节点", type: "ss", server: "", port: 443 };
export function NodePoolView({ onMessage }: { onMessage: (value: string) => void }) {
  const [sources, setSources] = useState<NodeSource[]>([]);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<ManagedNode | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkText, setLinkText] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const load = async () => { const [nextSources, nextNodes] = await Promise.all([api.listNodeSources(), api.listManagedNodes(sourceId || undefined)]); setSources(nextSources); setNodes(nextNodes); };
  useEffect(() => { load().catch(error => onMessage(error instanceof Error ? error.message : "节点池加载失败")); }, [sourceId]);
  const filtered = useMemo(() => nodes.filter(node => `${node.name} ${node.server} ${node.type} ${node.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [nodes, query]);
  async function save() { if (!editing) return; try { const created = await api.createManagedNode(editing); setNodes(current => [created, ...current]); setEditing(null); onMessage("节点已加入节点池"); } catch (error) { onMessage(error instanceof Error ? error.message : "节点保存失败"); } }
  async function removeSelected() { for (const id of selected) await api.deleteManagedNode(id); setSelected(new Set()); await load(); onMessage("已删除所选节点"); }
  async function importLinks() {
    if (!linkText.trim()) return;
    setLinkBusy(true);
    try {
      const parsed = await api.parseContent(linkText, "links");
      for (const node of parsed.nodes) await api.createManagedNode(node);
      setLinkText(""); await load(); onMessage(`已解析并导入 ${parsed.nodes.length} 个节点${parsed.warnings.length ? `，${parsed.warnings.length} 行未识别` : ""}`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "节点链接解析失败"); }
    finally { setLinkBusy(false); }
  }
  return <>
    <div className="view-toolbar"><div className="filter-cluster"><label className="search-field"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索节点、协议或标签"/></label><select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">全部来源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div><div className="row-actions"><button className="secondary-button" onClick={() => load()}><RefreshCw size={16}/>刷新</button><button className="secondary-button" onClick={() => setLinkText("vless://") }><Link2 size={16}/>粘贴链接</button><button className="primary-button" onClick={() => setEditing(blank)}><Plus size={17}/>手动添加</button></div></div>
    <div className="summary-inline"><span><strong>{nodes.length}</strong> 个节点</span><i/><span><strong>{sources.length}</strong> 个来源</span><i/><span><strong>{nodes.filter(node => node.enabled).length}</strong> 个已启用</span></div>{selected.size > 0 && <button className="secondary-button compact-button" onClick={removeSelected}><Trash2 size={15}/>删除所选 {selected.size}</button>}
    {filtered.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={event => setSelected(event.target.checked ? new Set(filtered.map(node => node.id)) : new Set())} aria-label="全选节点"/></th><th>节点</th><th>协议</th><th>服务器</th><th>来源</th><th>标签</th><th>状态</th><th/></tr></thead><tbody>{filtered.map(node => <tr key={node.id}><td><input type="checkbox" checked={selected.has(node.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(node.id) : next.delete(node.id); return next; })} aria-label={`选择 ${node.name}`}/></td><td><span className="entity-name"><span className="entity-icon"><Server size={16}/></span><strong>{node.name}</strong></span></td><td><span className="type-badge">{node.type.toUpperCase()}</span></td><td className="mono truncate-cell">{node.server}:{node.port}</td><td>{sources.find(source => source.id === node.sourceId)?.name || "手动"}</td><td>{node.tags.length ? node.tags.join("、") : "-"}</td><td><span className="status-ok"><CheckCircle2 size={15}/>已启用</span></td><td><div className="row-actions"><button className="icon-button compact" onClick={() => setEditing({ name: node.name, type: node.type, server: node.server, port: node.port })} aria-label={`编辑 ${node.name}`}><Pencil size={16}/></button><button className="icon-button compact" onClick={() => setEditing({ name: `${node.name} 副本`, type: node.type, server: node.server, port: node.port })} aria-label={`复制 ${node.name}`}><Copy size={16}/></button><button className="icon-button compact danger" onClick={() => setDeleting(node)} aria-label={`删除 ${node.name}`}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><div><Database size={24}/></div><h2>节点池还是空的</h2><p>从来源导入或手动添加第一个节点。</p><button className="primary-button" onClick={() => setEditing(blank)}><Plus size={17}/>添加节点</button></div>}
    <Drawer open={!!editing} onClose={() => setEditing(null)} title="添加节点" footer={<><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" onClick={save}>保存节点</button></>}><div className="form-grid"><label className="span-2">节点名称<input value={editing?.name || ""} onChange={event => setEditing(current => current ? {...current, name: event.target.value} : current)}/></label><label>协议<select value={editing?.type || "ss"} onChange={event => setEditing(current => current ? {...current, type: event.target.value} : current)}><option>ss</option><option>vmess</option><option>vless</option><option>trojan</option><option>hysteria2</option><option>tuic</option><option>socks5</option></select></label><label>端口<input type="number" value={editing?.port || 443} onChange={event => setEditing(current => current ? {...current, port: Number(event.target.value)} : current)}/></label><label className="span-2">服务器<input value={editing?.server || ""} onChange={event => setEditing(current => current ? {...current, server: event.target.value} : current)}/></label></div></Drawer>
    <Drawer open={!!linkText} onClose={() => setLinkText("")} title="导入节点链接" footer={<><button className="secondary-button" onClick={() => setLinkText("")}>取消</button><button className="primary-button" disabled={linkBusy || !linkText.trim()} onClick={() => void importLinks()}>{linkBusy ? <RefreshCw className="spin" size={16}/> : <FilePlus2 size={16}/>}解析并导入</button></>}><label className="import-textarea">VLESS / VMess / Trojan / SS 等链接<textarea autoFocus value={linkText === "vless://" ? "" : linkText} onChange={event => setLinkText(event.target.value)} placeholder="vless://...
vmess://...
ss://..." spellCheck={false}/></label><p className="form-hint"><Link2 size={15}/>支持一行一个链接，也支持整段 Base64 订阅内容。</p></Drawer>
    <ConfirmDialog open={!!deleting} title="删除节点" message={`确定从节点池删除“${deleting?.name}”吗？`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; await api.deleteManagedNode(deleting.id); setDeleting(null); await load(); onMessage("节点已删除"); }}/>
  </>;
}
