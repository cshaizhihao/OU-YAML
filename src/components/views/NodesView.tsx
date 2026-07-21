import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, KeyRound, MoreHorizontal, Network, Pencil, Plus, Search, Server, Trash2 } from "lucide-react";
import type { MihomoConfig, ProxyNode, ProxyType } from "../../shared/types";
import { createId } from "../../shared/id";
import { ConfirmDialog, Drawer } from "../Dialog";

const types: ProxyType[] = ["ss", "ssr", "vmess", "vless", "trojan", "snell", "socks5", "http", "hysteria2", "tuic", "wireguard"];
const blankNode = (): ProxyNode => ({ id: createId(), name: "新节点", type: "ss", server: "", port: 443, udp: true, cipher: "aes-128-gcm", extra: {} });

export function NodesView({ config, onChange }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [editing, setEditing] = useState<ProxyNode | null>(null);
  const [deleting, setDeleting] = useState<ProxyNode | null>(null);
  const filtered = useMemo(() => config.proxies.filter((node) => (type === "all" || node.type === type) && `${node.name} ${node.server}`.toLowerCase().includes(query.toLowerCase())), [config.proxies, query, type]);

  function save(node: ProxyNode) {
    const exists = config.proxies.some((item) => item.id === node.id);
    onChange({ ...config, proxies: exists ? config.proxies.map((item) => item.id === node.id ? node : item) : [...config.proxies, node] });
    setEditing(null);
  }
  function duplicate(node: ProxyNode) {
    onChange({ ...config, proxies: [...config.proxies, { ...node, id: createId(), name: `${node.name} 副本` }] });
  }
  function move(node: ProxyNode, direction: -1 | 1) {
    const index = config.proxies.findIndex((item) => item.id === node.id);
    const target = index + direction;
    if (target < 0 || target >= config.proxies.length) return;
    const proxies = [...config.proxies]; [proxies[index], proxies[target]] = [proxies[target], proxies[index]];
    onChange({ ...config, proxies });
  }

  return <>
    <div className="view-toolbar">
      <div className="filter-cluster"><label className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索节点" aria-label="搜索节点" /></label><select value={type} onChange={(e) => setType(e.target.value)} aria-label="协议筛选"><option value="all">全部协议</option>{types.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></div>
      <button className="primary-button" onClick={() => setEditing(blankNode())}><Plus size={17} />添加节点</button>
    </div>
    {filtered.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>协议</th><th>服务器</th><th>端口</th><th>传输</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{filtered.map((node) => <tr key={node.id}><td><button className="entity-name" onClick={() => setEditing({ ...node })}><span className="entity-icon"><Server size={17} /></span><strong>{node.name}</strong></button></td><td><span className="type-badge">{node.type.toUpperCase()}</span></td><td className="mono truncate-cell" title={node.server}>{node.server || "-"}</td><td className="mono">{node.port}</td><td>{node.network ? node.network.toUpperCase() : "TCP"}{node.tls && <span className="secure-dot" title="TLS"><KeyRound size={13} /></span>}</td><td><div className="row-actions"><button onClick={() => move(node, -1)} className="icon-button compact" aria-label={`上移 ${node.name}`}><ArrowUp size={16} /></button><button onClick={() => move(node, 1)} className="icon-button compact" aria-label={`下移 ${node.name}`}><ArrowDown size={16} /></button><button onClick={() => duplicate(node)} className="icon-button compact" aria-label={`复制 ${node.name}`}><Copy size={16} /></button><button onClick={() => setEditing({ ...node })} className="icon-button compact" aria-label={`编辑 ${node.name}`}><Pencil size={16} /></button><button onClick={() => setDeleting(node)} className="icon-button compact danger" aria-label={`删除 ${node.name}`}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><div><Network size={24} /></div><h2>{config.proxies.length ? "没有匹配的节点" : "还没有节点"}</h2><button className="primary-button" onClick={() => setEditing(blankNode())}><Plus size={17} />添加节点</button></div>}
    <NodeEditor key={editing?.id || "closed"} node={editing} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除节点" message={`确定删除“${deleting?.name}”吗？策略组中的同名引用不会自动删除。`} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) onChange({ ...config, proxies: config.proxies.filter((item) => item.id !== deleting.id) }); setDeleting(null); }} />
  </>;
}

function NodeEditor({ node, onClose, onSave }: { node: ProxyNode | null; onClose: () => void; onSave: (node: ProxyNode) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState<ProxyNode | null>(node);
  if (!node) return null;
  if (!draft) return null;
  const set = <K extends keyof ProxyNode>(key: K, value: ProxyNode[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  return <Drawer title={configTitle(draft)} open onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onSave(draft)}>保存节点</button></>}>
    <div className="form-grid">
      <label className="span-2">节点名称<input value={draft.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label>协议<select value={draft.type} onChange={(e) => set("type", e.target.value)}>{types.map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}</select></label>
      <label>端口<input type="number" min={1} max={65535} value={draft.port} onChange={(e) => set("port", Number(e.target.value))} /></label>
      <label className="span-2">服务器地址<input value={draft.server} onChange={(e) => set("server", e.target.value)} placeholder="example.com" /></label>
      {(draft.type === "vmess" || draft.type === "vless") && <label className="span-2">UUID<input value={draft.uuid || ""} onChange={(e) => set("uuid", e.target.value)} /></label>}
      {draft.type !== "vmess" && draft.type !== "vless" && <label className="span-2">密码<input type="password" value={draft.password || ""} onChange={(e) => set("password", e.target.value)} /></label>}
      {draft.type === "ss" && <label className="span-2">加密方式<input value={draft.cipher || ""} onChange={(e) => set("cipher", e.target.value)} /></label>}
      <label className="toggle-row span-2"><span><strong>UDP</strong><small>允许该节点转发 UDP</small></span><input type="checkbox" checked={!!draft.udp} onChange={(e) => set("udp", e.target.checked)} /></label>
      <label className="toggle-row span-2"><span><strong>TLS</strong><small>启用传输层加密</small></span><input type="checkbox" checked={!!draft.tls} onChange={(e) => set("tls", e.target.checked)} /></label>
    </div>
    <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)}><MoreHorizontal size={18} />高级设置</button>
    {advanced && <div className="form-grid advanced-fields">
      <label className="span-2">SNI<input value={draft.sni || ""} onChange={(e) => set("sni", e.target.value)} /></label>
      <label>传输<select value={draft.network || "tcp"} onChange={(e) => set("network", e.target.value)}><option value="tcp">TCP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option></select></label>
      <label className="toggle-row compact-toggle"><span>跳过证书验证</span><input type="checkbox" checked={!!draft.skipCertVerify} onChange={(e) => set("skipCertVerify", e.target.checked)} /></label>
      {draft.network === "ws" && <><label className="span-2">WebSocket 路径<input value={draft.wsPath || ""} onChange={(e) => set("wsPath", e.target.value)} /></label><label className="span-2">WebSocket Host<input value={draft.wsHost || ""} onChange={(e) => set("wsHost", e.target.value)} /></label></>}
      {draft.network === "grpc" && <label className="span-2">gRPC Service Name<input value={draft.grpcServiceName || ""} onChange={(e) => set("grpcServiceName", e.target.value)} /></label>}
    </div>}
  </Drawer>;
}

function configTitle(node: ProxyNode) { return node.server || node.name !== "新节点" ? `编辑 ${node.name}` : "添加节点"; }
