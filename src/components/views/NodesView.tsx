import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, KeyRound, MoreHorizontal, Network, Pencil, Plus, Search, Server, Trash2 } from "lucide-react";
import type { MihomoConfig, ProxyNode, ProxyType } from "../../shared/types";
import { createId } from "../../shared/id";
import { ConfirmDialog, Modal } from "../Dialog";
import { CountryFlag, FormattedNodeName, COMMON_FLAG_LIST, replaceNodeCountry } from "../CountryFlag";

const types: ProxyType[] = ["ss", "ssr", "vmess", "vless", "trojan", "snell", "socks5", "http", "hysteria2", "tuic", "wireguard"];
const blankNode = (): ProxyNode => ({ id: createId(), name: "新节点", type: "ss", server: "", port: 443, udp: true, cipher: "aes-128-gcm", extra: {} });

export function NodesView({ config, onChange, onMessage }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void; onMessage?: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [editing, setEditing] = useState<ProxyNode | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [flagPickerNode, setFlagPickerNode] = useState<ProxyNode | null>(null);
  const [deleting, setDeleting] = useState<ProxyNode | null>(null);
  const filtered = useMemo(() => config.proxies.filter((node) => (type === "all" || node.type === type) && `${node.name} ${node.server}`.toLowerCase().includes(query.toLowerCase())), [config.proxies, query, type]);

  function save(node: ProxyNode) {
    const normalized = { ...node, name: node.name.trim() };
    if (!normalized.name) { onMessage?.("节点名称不能为空"); return; }
    if (config.proxies.some((item) => item.id !== normalized.id && item.name === normalized.name)) { onMessage?.("节点名称不能重复"); return; }
    const exists = config.proxies.some((item) => item.id === normalized.id);
    onChange({ ...config, proxies: exists ? config.proxies.map((item) => item.id === normalized.id ? normalized : item) : [...config.proxies, normalized] });
    setEditing(null);
  }

  function saveRename() {
    if (!renaming || !renaming.name.trim()) return;
    const trimmed = renaming.name.trim();
    if (config.proxies.some((item) => item.id !== renaming.id && item.name === trimmed)) {
      onMessage?.("节点名称不能重复");
      return;
    }
    const old = config.proxies.find((p) => p.id === renaming.id);
    onChange({
      ...config,
      proxies: config.proxies.map((p) => p.id === renaming.id ? { ...p, name: trimmed } : p),
      proxyGroups: old ? config.proxyGroups.map((g) => ({
        ...g,
        proxies: g.proxies.map((name) => name === old.name ? trimmed : name)
      })) : config.proxyGroups,
    });
    setRenaming(null);
    onMessage?.("节点名称已更新");
  }

  function selectFlag(node: ProxyNode, code: string | null) {
    const newName = replaceNodeCountry(node.name, code);
    onChange({
      ...config,
      proxies: config.proxies.map((p) => p.id === node.id ? { ...p, name: newName } : p),
      proxyGroups: config.proxyGroups.map((g) => ({
        ...g,
        proxies: g.proxies.map((name) => name === node.name ? newName : name)
      })),
    });
    setFlagPickerNode(null);
    onMessage?.(code ? `已将节点地区更新为 [${code}]` : "已清除地区国旗");
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
    {filtered.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>协议</th><th>服务器</th><th>端口</th><th>传输</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{filtered.map((node) => <tr key={node.id}><td><button className="entity-name" onClick={() => setRenaming({ id: node.id, name: node.name })}><span className="entity-icon"><Server size={17} /></span><strong style={{ display: "inline-flex", alignItems: "center" }}><FormattedNodeName name={node.name} onFlagClick={() => setFlagPickerNode(node)} /></strong></button></td><td><span className="type-badge">{node.type.toUpperCase()}</span></td><td className="mono truncate-cell" title={node.server}>{node.server || "-"}</td><td className="mono">{node.port}</td><td>{node.network ? node.network.toUpperCase() : "TCP"}{node.tls && <span className="secure-dot" title="TLS"><KeyRound size={13} /></span>}</td><td><div className="row-actions"><button onClick={() => move(node, -1)} className="icon-button compact" aria-label={`上移 ${node.name}`}><ArrowUp size={16} /></button><button onClick={() => move(node, 1)} className="icon-button compact" aria-label={`下移 ${node.name}`}><ArrowDown size={16} /></button><button onClick={() => duplicate(node)} className="icon-button compact" aria-label={`复制 ${node.name}`}><Copy size={16} /></button><button onClick={() => setRenaming({ id: node.id, name: node.name })} className="icon-button compact" aria-label={`重命名 ${node.name}`} title="重命名节点"><Pencil size={16} /></button><button onClick={() => setDeleting(node)} className="icon-button compact danger" aria-label={`删除 ${node.name}`}><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-state-icon"><Network size={24} /></div><h2>{config.proxies.length ? "没有匹配的节点" : "还没有节点"}</h2><button className="primary-button" onClick={() => setEditing(blankNode())}><Plus size={17} />添加节点</button></div>}

    {/* 重命名节点弹窗 */}
    <Modal
      size="compact"
      open={!!renaming}
      onClose={() => setRenaming(null)}
      title="重命名节点"
      footer={
        <>
          <button className="secondary-button" onClick={() => setRenaming(null)}>取消</button>
          <button className="primary-button" disabled={!renaming?.name.trim()} onClick={saveRename}>保存名称</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label className="editor-name">
          节点名称
          <input
            value={renaming?.name || ""}
            autoFocus
            maxLength={120}
            onChange={(e) => setRenaming(renaming ? { ...renaming, name: e.target.value } : null)}
            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }}
          />
        </label>
        <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ink-faint)" }}>
          仅重命名节点，策略组中的同名引用会自动同步更新。
        </p>
      </div>
    </Modal>

    {/* 国旗选择弹窗 */}
    <Modal
      size="compact"
      open={!!flagPickerNode}
      onClose={() => setFlagPickerNode(null)}
      title={`选择地区国旗 · ${flagPickerNode?.name || ""}`}
      footer={<button className="secondary-button" onClick={() => setFlagPickerNode(null)}>关闭</button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
          {COMMON_FLAG_LIST.map((item) => (
            <button
              key={item.code}
              type="button"
              className="flag-select-btn"
              onClick={() => flagPickerNode && selectFlag(flagPickerNode, item.code)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--line)",
                background: "rgba(22, 28, 44, 0.6)",
                color: "#ffffff",
                cursor: "pointer",
                fontSize: "12.5px",
                textAlign: "left",
              }}
            >
              <CountryFlag code={item.code} />
              <span>{item.name}</span>
              <small style={{ marginLeft: "auto", color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>{item.code}</small>
            </button>
          ))}
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
          <button type="button" className="text-button" onClick={() => flagPickerNode && selectFlag(flagPickerNode, null)} style={{ color: "var(--danger)", fontSize: "12px" }}>
            清除地区国旗
          </button>
        </div>
      </div>
    </Modal>

    <NodeEditor key={editing?.id || "closed"} node={editing} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除节点" message={`确定删除“${deleting?.name}”吗？它在策略组中的引用会自动清理。`} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) onChange({ ...config, proxies: config.proxies.filter((item) => item.id !== deleting.id), proxyGroups: config.proxyGroups.map((group) => ({ ...group, proxies: group.proxies.filter((member) => member !== deleting.name) })) }); setDeleting(null); }} />
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
