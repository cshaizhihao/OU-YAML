import { useEffect, useMemo, useState } from "react";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, Copy, Database, FilePlus2, GripVertical, Link2, Pencil, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode, NodeSource } from "../../shared/domain";
import type { MihomoConfig, ProxyNode } from "../../shared/types";
import { createId } from "../../shared/id";
import { Drawer, ConfirmDialog } from "../Dialog";

type NodeDraft = { id?: string; name: string; type: string; server: string; port: number; udp?: boolean; tls?: boolean; skipCertVerify?: boolean; sni?: string; uuid?: string; password?: string; cipher?: string; network?: string; wsPath?: string; wsHost?: string; grpcServiceName?: string; extra?: Record<string, unknown>; tags?: string[]; note?: string };
const blank: NodeDraft = { name: "新节点", type: "ss", server: "", port: 443, extra: {}, tags: [] };

function nodeDraft(node: ManagedNode): NodeDraft { return { ...node, extra: node.extra || {}, tags: node.tags || [] }; }
function nodeFingerprint(node: ProxyNode) {
  return [node.type, node.server, node.port, node.uuid || "", node.password || "", node.cipher || "", node.sni || "", node.network || "", node.wsPath || "", node.wsHost || "", node.grpcServiceName || "", node.udp ?? "", node.tls ?? "", node.skipCertVerify ?? "", JSON.stringify(node.extra || {}), JSON.stringify(node.formatExtra || {})].join("|").toLowerCase();
}

export function NodePoolView({ config, onConfig, onMessage }: { config: MihomoConfig; onConfig: (config: MihomoConfig) => void; onMessage: (value: string) => void }) {
  const [sources, setSources] = useState<NodeSource[]>([]);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<NodeDraft | null>(null);
  const [deleting, setDeleting] = useState<ManagedNode | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkPreview, setLinkPreview] = useState<{ nodes: ProxyNode[]; warnings: string[] } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const load = async () => {
    const [nextSources, nextNodes] = await Promise.all([api.listNodeSources(), api.listManagedNodes()]);
    setSources(nextSources); setNodes(nextNodes); setSelected(new Set());
  };
  useEffect(() => { load().catch(error => onMessage(error instanceof Error ? error.message : "节点池加载失败")); }, [sourceId]);
  const filtered = useMemo(() => nodes.filter(node => (!sourceId || node.sourceId === sourceId) && `${node.name} ${node.server} ${node.type} ${node.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [nodes, query, sourceId]);
  const visibleIds = useMemo(() => filtered.map(node => node.id), [filtered]);
  const sourceNames = useMemo(() => new Map(sources.map(source => [source.id, source.name])), [sources]);

  async function save() {
    if (!editing) return;
    try {
      if (editing.id) await api.updateManagedNode(editing.id, editing as Required<Pick<NodeDraft, "name" | "type" | "server" | "port">>);
      else await api.createManagedNode(editing as Required<Pick<NodeDraft, "name" | "type" | "server" | "port">>);
      setEditing(null); await load(); onMessage(editing.id ? "节点已更新" : "节点已加入节点池");
    } catch (error) { onMessage(error instanceof Error ? error.message : "节点保存失败"); }
  }

  async function removeSelected() {
    try { for (const id of selected) await api.deleteManagedNode(id); setSelected(new Set()); await load(); onMessage("已删除所选节点"); }
    catch (error) { onMessage(error instanceof Error ? error.message : "批量删除失败"); }
  }

  function addSelectedToProject() {
    const selectedNodes = nodes.filter((node) => selected.has(node.id));
    if (!selectedNodes.length) return;
    const fingerprints = new Set(config.proxies.map(nodeFingerprint));
    const names = new Set(config.proxies.map((node) => node.name));
    const ids = new Set(config.proxies.map((node) => node.id));
    const additions: ProxyNode[] = [];
    for (const managed of selectedNodes) {
      const fingerprint = nodeFingerprint(managed);
      if (fingerprints.has(fingerprint)) continue;
      let name = managed.name.trim() || `${managed.type.toUpperCase()} 节点`;
      const base = name;
      let suffix = 2;
      while (names.has(name)) name = `${base} ${suffix++}`;
      names.add(name); fingerprints.add(fingerprint);
      const id = ids.has(managed.id) ? createId() : managed.id;
      ids.add(id);
      additions.push({ id, name, type: managed.type, server: managed.server, port: managed.port, udp: managed.udp, tls: managed.tls, skipCertVerify: managed.skipCertVerify, sni: managed.sni, uuid: managed.uuid, password: managed.password, cipher: managed.cipher, network: managed.network, wsPath: managed.wsPath, wsHost: managed.wsHost, grpcServiceName: managed.grpcServiceName, extra: managed.extra || {}, formatExtra: managed.formatExtra });
    }
    onConfig({ ...config, proxies: [...config.proxies, ...additions] });
    setSelected(new Set());
    onMessage(additions.length ? `已加入当前配置 ${additions.length} 个节点${additions.length < selectedNodes.length ? `，跳过重复 ${selectedNodes.length - additions.length} 个` : ""}` : "所选节点已在当前配置中");
  }

  async function previewLinks() {
    if (!linkText.trim()) return;
    setLinkBusy(true);
    try {
      const parsed = await api.parseContent(linkText, "links");
      setLinkPreview({ nodes: parsed.nodes, warnings: parsed.warnings });
    } catch (error) { setLinkPreview(null); onMessage(error instanceof Error ? error.message : "节点链接解析失败"); }
    finally { setLinkBusy(false); }
  }

  async function importLinks() {
    if (!linkPreview?.nodes.length) return;
    setLinkBusy(true);
    try {
      const existing = new Set(nodes.map(nodeFingerprint));
      let imported = 0; let duplicates = 0;
      for (const node of linkPreview.nodes) {
        const fingerprint = nodeFingerprint(node);
        if (existing.has(fingerprint)) { duplicates += 1; continue; }
        await api.createManagedNode(node); existing.add(fingerprint); imported += 1;
      }
      const total = linkPreview.nodes.length;
      setLinkOpen(false); setLinkText(""); setLinkPreview(null); await load(); onMessage(`解析 ${total} 个节点，导入 ${imported} 个，跳过重复 ${duplicates} 个`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "节点导入失败"); }
    finally { setLinkBusy(false); }
  }

  async function reorder(next: ManagedNode[]) {
    const previous = nodes; setNodes(next); setOrderBusy(true);
    try { await api.reorderManagedNodes(next.map(node => node.id)); }
    catch (error) { setNodes(previous); onMessage(error instanceof Error ? error.message : "节点排序失败"); }
    finally { setOrderBusy(false); }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id || orderBusy) return;
    const activeIdValue = String(event.active.id).replace(/^node:/, ""); const overIdValue = String(event.over.id).replace(/^node:/, "");
    const from = visibleIds.indexOf(activeIdValue); const to = visibleIds.indexOf(overIdValue);
    if (from < 0 || to < 0) return;
    const reorderedVisible = [...filtered]; const [moved] = reorderedVisible.splice(from, 1); reorderedVisible.splice(to, 0, moved);
    let cursor = 0; const visibleSet = new Set(visibleIds);
    const next = nodes.map(node => visibleSet.has(node.id) ? reorderedVisible[cursor++] : node);
    void reorder(next);
  }

  const toggleSelected = (id: string, checked: boolean) => setSelected(current => { const next = new Set(current); checked ? next.add(id) : next.delete(id); return next; });
  const allVisibleSelected = filtered.length > 0 && filtered.every(node => selected.has(node.id));
  const updateEditing = (key: keyof NodeDraft, value: string | number) => setEditing(current => current ? { ...current, [key]: value } : current);

  return <>
    <div className="view-toolbar node-pool-toolbar"><div className="filter-cluster"><label className="search-field"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索节点、协议或标签"/></label><select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">全部来源</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></div><div className="row-actions"><button className="secondary-button" onClick={() => void load()} disabled={orderBusy}><RefreshCw size={16}/>刷新</button><button className="secondary-button" onClick={() => { setLinkOpen(true); setLinkPreview(null); }}><Link2 size={16}/>导入链接</button><button className="primary-button" onClick={() => setEditing({ ...blank })}><Plus size={17}/>手动添加</button></div></div>
    <div className="summary-inline node-pool-summary"><span><strong>{nodes.length}</strong> 个节点</span><i/><span><strong>{sources.length}</strong> 个来源</span><i/><span><strong>{nodes.filter(node => node.enabled).length}</strong> 个已启用</span>{orderBusy && <><i/><span className="status-ok"><RefreshCw className="spin" size={14}/>保存排序中</span></>}</div>
    {selected.size > 0 && <div className="node-selection-actions"><button className="primary-button compact-button" onClick={addSelectedToProject} disabled={orderBusy}><Plus size={15}/>加入当前配置 {selected.size}</button><button className="secondary-button compact-button" onClick={() => void removeSelected()} disabled={orderBusy}><Trash2 size={15}/>删除所选 {selected.size}</button></div>}
    {filtered.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event => setActiveId(String(event.active.id).replace(/^node:/, ""))} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}><SortableContext items={visibleIds.map(id => `node:${id}`)} strategy={verticalListSortingStrategy}><div className="node-list" role="table" aria-label="节点池"><div className="node-list-header" role="row"><span><input type="checkbox" checked={allVisibleSelected} onChange={event => setSelected(event.target.checked ? new Set([...selected, ...visibleIds]) : new Set([...selected].filter(id => !visibleIds.includes(id))))} aria-label="选择当前节点"/></span><span>节点</span><span>协议</span><span>服务器</span><span>来源</span><span>标签</span><span>状态</span><span>操作</span></div>{filtered.map(node => <SortableNodeRow key={node.id} node={node} sourceName={node.sourceId ? sourceNames.get(node.sourceId) : undefined} selected={selected.has(node.id)} onSelect={checked => toggleSelected(node.id, checked)} onEdit={() => setEditing(nodeDraft(node))} onCopy={() => setEditing({ ...nodeDraft(node), id: undefined, name: `${node.name} 副本` })} onDelete={() => setDeleting(node)} />)}</div></SortableContext><DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>{activeId ? <div className="node-drag-overlay"><GripVertical size={16}/><strong>{nodes.find(node => node.id === activeId)?.name || "节点"}</strong></div> : null}</DragOverlay></DndContext> : <div className="empty-state"><div><Database size={24}/></div><h2>{query ? "没有匹配的节点" : "节点池还是空的"}</h2><p>{query ? "换个关键词试试。" : "从订阅、节点链接或手动添加第一个节点。"}</p>{!query && <div className="empty-actions"><button className="secondary-button" onClick={() => setLinkOpen(true)}><Link2 size={16}/>导入链接</button><button className="primary-button" onClick={() => setEditing({ ...blank })}><Plus size={17}/>手动添加</button></div>}</div>}
    <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "编辑节点" : "添加节点"} footer={<><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={!editing || !editing.name.trim() || !editing.server.trim() || !Number.isInteger(editing.port) || editing.port < 1 || editing.port > 65535} onClick={() => void save()}>保存节点</button></>}><div className="form-grid"><label className="span-2">节点名称<input value={editing?.name || ""} onChange={event => updateEditing("name", event.target.value)} /></label><label>协议<select value={editing?.type || "ss"} onChange={event => updateEditing("type", event.target.value)}><option>ss</option><option>ssr</option><option>vmess</option><option>vless</option><option>trojan</option><option>hysteria2</option><option>tuic</option><option>socks5</option><option>http</option></select></label><label>端口<input type="number" min={1} max={65535} value={editing?.port || 443} onChange={event => updateEditing("port", Number(event.target.value))}/></label><label className="span-2">服务器<input value={editing?.server || ""} onChange={event => updateEditing("server", event.target.value)}/></label><label>UUID / 用户名<input value={editing?.uuid || ""} onChange={event => updateEditing("uuid", event.target.value)} /></label><label>密码<input type="password" autoComplete="off" value={editing?.password || ""} onChange={event => updateEditing("password", event.target.value)} /></label><label>加密方式<input value={editing?.cipher || ""} onChange={event => updateEditing("cipher", event.target.value)} placeholder="例如 aes-128-gcm" /></label><label>传输方式<input value={editing?.network || ""} onChange={event => updateEditing("network", event.target.value)} placeholder="tcp / ws / grpc" /></label><label className="span-2">SNI / Server Name<input value={editing?.sni || ""} onChange={event => updateEditing("sni", event.target.value)} /></label><label>WS 路径<input value={editing?.wsPath || ""} onChange={event => updateEditing("wsPath", event.target.value)} /></label><label>WS Host<input value={editing?.wsHost || ""} onChange={event => updateEditing("wsHost", event.target.value)} /></label><label className="span-2">gRPC Service Name<input value={editing?.grpcServiceName || ""} onChange={event => updateEditing("grpcServiceName", event.target.value)} /></label><label className="toggle-row span-2"><span><strong>TLS</strong><small>启用加密传输</small></span><input type="checkbox" checked={!!editing?.tls} onChange={event => setEditing(current => current ? { ...current, tls: event.target.checked } : current)} /></label><label className="toggle-row span-2"><span><strong>跳过证书校验</strong><small>仅在确认服务端配置时使用</small></span><input type="checkbox" checked={!!editing?.skipCertVerify} onChange={event => setEditing(current => current ? { ...current, skipCertVerify: event.target.checked } : current)} /></label></div><p className="form-hint"><Pencil size={15}/>协议链接导入会自动填充更多专属参数；未填写的可选字段不会写入导出配置。</p></Drawer>
    <Drawer open={linkOpen} onClose={() => { setLinkOpen(false); setLinkPreview(null); }} title="导入节点链接" footer={<><button className="secondary-button" onClick={() => { setLinkOpen(false); setLinkPreview(null); }}>取消</button>{linkPreview ? <button className="primary-button" disabled={linkBusy || !linkPreview.nodes.length} onClick={() => void importLinks()}>{linkBusy ? <RefreshCw className="spin" size={16}/> : <FilePlus2 size={16}/>}导入预览节点</button> : <button className="primary-button" disabled={linkBusy || !linkText.trim()} onClick={() => void previewLinks()}>{linkBusy ? <RefreshCw className="spin" size={16}/> : <Search size={16}/>}解析预览</button>}</>}><label className="import-textarea">VLESS / VMess / Trojan / SS 等链接<textarea autoFocus value={linkText} onChange={event => { setLinkText(event.target.value); setLinkPreview(null); }} placeholder="vless://...\nvmess://...\nss://..." spellCheck={false}/></label>{linkPreview && <div className="import-preview"><strong>解析结果：{linkPreview.nodes.length} 个节点</strong>{linkPreview.nodes.slice(0, 8).map(node => <div key={node.id}><span>{node.name}</span><small>{node.type.toUpperCase()} · {node.server}:{node.port}</small></div>)}{linkPreview.nodes.length > 8 && <small>还有 {linkPreview.nodes.length - 8} 个节点</small>}{linkPreview.warnings.length > 0 && <div className="import-warnings"><strong>以下内容未识别：</strong>{linkPreview.warnings.slice(0, 12).map((warning, index) => <small key={`${warning}-${index}`}>{warning}</small>)}{linkPreview.warnings.length > 12 && <small>还有 {linkPreview.warnings.length - 12} 条</small>}</div>}</div>}<p className="form-hint"><Link2 size={15}/>支持一行一个链接，也支持整段 Base64 订阅内容。</p></Drawer>
    <ConfirmDialog open={!!deleting} title="删除节点" message={`确定从节点池删除“${deleting?.name}”吗？`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; await api.deleteManagedNode(deleting.id); setDeleting(null); await load(); onMessage("节点已删除"); }}/>
  </>;
}

function SortableNodeRow({ node, sourceName, selected, onSelect, onEdit, onCopy, onDelete }: { node: ManagedNode; sourceName?: string; selected: boolean; onSelect: (checked: boolean) => void; onEdit: () => void; onCopy: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `node:${node.id}`, data: { kind: "managed-node", nodeId: node.id } });
  return <div ref={setNodeRef} className={`node-row${isDragging ? " dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }} role="row"><span className="node-row-check"><button className="drag-handle" {...listeners} {...attributes} aria-label={`拖动节点 ${node.name}`}><GripVertical size={16}/></button><input type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} aria-label={`选择 ${node.name}`}/></span><span className="node-row-name"><span className="entity-icon"><Server size={16}/></span><strong title={node.name}>{node.name}</strong></span><span className="node-row-type"><span className="type-badge">{node.type.toUpperCase()}</span></span><span className="node-row-server mono" title={`${node.server}:${node.port}`}>{node.server}:{node.port}</span><span className="node-row-source" title={sourceName || "手动添加"}>{sourceName || "手动添加"}</span><span className="node-row-tags" title={node.tags.join("、")}>{node.tags.length ? node.tags.join("、") : "-"}</span><span className="node-row-status"><span className="status-ok"><CheckCircle2 size={15}/>已启用</span></span><span className="node-row-actions"><button className="icon-button compact" onClick={onEdit} aria-label={`编辑 ${node.name}`}><Pencil size={16}/></button><button className="icon-button compact" onClick={onCopy} aria-label={`复制 ${node.name}`}><Copy size={16}/></button><button className="icon-button compact danger" onClick={onDelete} aria-label={`删除 ${node.name}`}><Trash2 size={16}/></button></span></div>;
}
