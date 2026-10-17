import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Activity, Ban, CheckCircle2, CircleX, Copy, Database, FilePlus2, Flag, GripVertical, Link2, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Search, Server, Sparkles, Tags, Trash2, Unlink, WandSparkles } from "lucide-react";
import { api, type TcpPingResult } from "../../api";
import { latencyLevel } from "../../shared/diagnostics";
import type { ManagedNode, NodeSource } from "../../shared/domain";
import type { MihomoConfig, ProxyNode } from "../../shared/types";
import { copyText } from "../../shared/clipboard";
import { serializeShareLink } from "../../shared/links";
import { guideTargets } from "../../guides/registry";
import { createId } from "../../shared/id";
import { Modal, Drawer, ConfirmDialog } from "../Dialog";
import { CountryFlag, FormattedNodeName, COMMON_FLAG_LIST, replaceNodeCountry } from "../CountryFlag";

type NodeDraft = {
  id?: string;
  name: string;
  type: string;
  server: string;
  port: number;
  enabled?: boolean;
  udp?: boolean;
  tls?: boolean;
  skipCertVerify?: boolean;
  sni?: string;
  uuid?: string;
  password?: string;
  cipher?: string;
  network?: string;
  wsPath?: string;
  wsHost?: string;
  grpcServiceName?: string;
  extra?: Record<string, unknown>;
  tags?: string[];
  note?: string;
};

type BatchDraft = { addTags: string; removeTags: string; prefix: string; find: string; replace: string };
type NodeDiagnostic = Partial<TcpPingResult> & { country?: string; countryCode?: string; countryIp?: string; exitIp?: string; probeStatus?: "result" | "error" | "unsupported"; mode?: "tcp" | "proxy"; checkedAt?: string };

const blank: NodeDraft = { name: "新节点", type: "ss", server: "", port: 443, enabled: true, extra: {}, tags: [] };
const emptyBatch = (): BatchDraft => ({ addTags: "", removeTags: "", prefix: "", find: "", replace: "" });
const splitTags = (value: string) => [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];

async function runLimited<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function nodeDraft(node: ManagedNode): NodeDraft {
  return { ...node, extra: node.extra || {}, tags: node.tags || [] };
}

function nodeFingerprint(node: ProxyNode) {
  return [node.type, node.server, node.port, node.uuid || "", node.password || "", node.cipher || "", node.sni || "", node.network || "", node.wsPath || "", node.wsHost || "", node.grpcServiceName || "", node.udp ?? "", node.tls ?? "", node.skipCertVerify ?? "", JSON.stringify(node.extra || {}), JSON.stringify(node.formatExtra || {})].join("|").toLowerCase();
}

function proxyFromManaged(node: ManagedNode, id = node.id, name = node.name): ProxyNode {
  return {
    id,
    name,
    type: node.type,
    server: node.server,
    port: node.port,
    udp: node.udp,
    tls: node.tls,
    skipCertVerify: node.skipCertVerify,
    sni: node.sni,
    uuid: node.uuid,
    password: node.password,
    cipher: node.cipher,
    network: node.network,
    wsPath: node.wsPath,
    wsHost: node.wsHost,
    grpcServiceName: node.grpcServiceName,
    extra: node.extra || {},
    formatExtra: node.formatExtra,
  };
}

function withoutProjectNodes(config: MihomoConfig, ids: Set<string>, names: Set<string>): MihomoConfig {
  return {
    ...config,
    proxies: config.proxies.filter((node) => !ids.has(node.id)),
    proxyGroups: config.proxyGroups.map((group) => ({ ...group, proxies: group.proxies.filter((member) => !names.has(member)) })),
    rules: config.rules.map((rule) => names.has(rule.target) ? { ...rule, target: "DIRECT" } : rule),
  };
}

export function NodePoolView({ config, onConfig, onProjectReload, onMessage, onOpenSources }: { config: MihomoConfig; onConfig: (config: MihomoConfig) => void; onProjectReload: () => Promise<void>; onMessage: (value: string) => void; onOpenSources: () => void }) {
  const [sources, setSources] = useState<NodeSource[]>([]);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<NodeDraft | null>(null);
  const [renamingNode, setRenamingNode] = useState<{ id: string; name: string } | null>(null);
  const [flagPickerNode, setFlagPickerNode] = useState<ManagedNode | null>(null);
  const [deleting, setDeleting] = useState<ManagedNode | null>(null);
  const [batchDeleting, setBatchDeleting] = useState<ManagedNode[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDraft, setBatchDraft] = useState<BatchDraft | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkMode, setLinkMode] = useState<"auto" | "links">("auto");
  const [linkError, setLinkError] = useState("");
  const [linkPreview, setLinkPreview] = useState<{ nodes: ProxyNode[]; warnings: string[] } | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [probeMode, setProbeMode] = useState<"tcp" | "proxy">("tcp");
  const [page, setPage] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState<Set<string>>(new Set());
  const [flagBusy, setFlagBusy] = useState<Set<string>>(new Set());
  const [diagnostics, setDiagnostics] = useState<Record<string, NodeDiagnostic>>({});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }));

  const load = async (keepSelection = false) => {
    const [nextSources, nextNodes] = await Promise.all([api.listNodeSources(), api.listManagedNodes()]);
    setSources(nextSources);
    setNodes(nextNodes);
    if (!keepSelection) setSelected(new Set());
  };

  useEffect(() => { void load().catch((error) => onMessage(error instanceof Error ? error.message : "节点库加载失败")); }, []);

  const matchingNodes = useMemo(() => nodes.filter((node) => {
    const search = `${node.name} ${node.server} ${node.type} ${node.tags.join(" ")} ${node.note || ""}`.toLowerCase();
    return (!sourceId || node.sourceId === sourceId) && search.includes(query.trim().toLowerCase());
  }), [nodes, query, sourceId]);
  useEffect(() => setPage(0), [query, sourceId]);
  const pageCount = Math.max(1, Math.ceil(matchingNodes.length / 100));
  const currentPage = Math.min(page, pageCount - 1);
  const filtered = useMemo(() => matchingNodes.slice(currentPage * 100, (currentPage + 1) * 100), [matchingNodes, currentPage]);
  const visibleIds = useMemo(() => filtered.map((node) => node.id), [filtered]);
  const sourceNames = useMemo(() => new Map(sources.map((source) => [source.id, source.name])), [sources]);
  const projectNodeIds = useMemo(() => new Set(config.proxies.map((node) => node.id)), [config.proxies]);
  const projectFingerprints = useMemo(() => new Set(config.proxies.map(nodeFingerprint)), [config.proxies]);
  const selectedNodes = useMemo(() => nodes.filter((node) => selected.has(node.id)), [nodes, selected]);

  async function save() {
    if (!editing) return;
    try {
      const payload = editing as Required<Pick<NodeDraft, "name" | "type" | "server" | "port">>;
      if (editing.id) {
        await api.updateManagedNode(editing.id, payload);
        await onProjectReload();
      }
      else await api.createManagedNode(payload);
      setEditing(null);
      await load();
      onMessage(editing.id ? "节点已更新" : "节点已加入节点库");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "节点保存失败");
    }
  }

  async function deleteNodes(targets: ManagedNode[]) {
    if (!targets.length) return;
    const ids = new Set(targets.map((node) => node.id));
    const projectNames = new Set(config.proxies.filter((node) => ids.has(node.id)).map((node) => node.name));
    try {
      await Promise.all(targets.map((node) => api.deleteManagedNode(node.id)));
      await onProjectReload();
      setSelected((current) => new Set([...current].filter((id) => !ids.has(id))));
      await load(true);
      onMessage(`已删除 ${targets.length} 个节点${projectNames.size ? `，并从当前项目移除 ${projectNames.size} 个引用` : ""}`);
    } catch (error) {
      await onProjectReload().catch(() => undefined);
      await load(true).catch(() => undefined);
      onMessage(error instanceof Error ? error.message : "节点删除失败");
    }
  }

  function addSelectedToProject() {
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
      names.add(name);
      fingerprints.add(fingerprint);
      const id = ids.has(managed.id) ? createId() : managed.id;
      ids.add(id);
      additions.push(proxyFromManaged(managed, id, name));
    }
    onConfig({ ...config, proxies: [...config.proxies, ...additions] });
    setSelected(new Set());
    onMessage(additions.length ? `已加入当前项目 ${additions.length} 个节点${additions.length < selectedNodes.length ? `，跳过重复 ${selectedNodes.length - additions.length} 个` : ""}` : "所选节点已在当前项目中");
  }

  function removeSelectedFromProject() {
    const ids = new Set(selectedNodes.map((node) => node.id));
    const names = new Set(config.proxies.filter((node) => ids.has(node.id)).map((node) => node.name));
    if (!names.size) return onMessage("所选节点没有加入当前项目");
    onConfig(withoutProjectNodes(config, ids, names));
    setSelected(new Set());
    onMessage(`已从当前项目移除 ${names.size} 个节点，节点库数据仍然保留`);
  }

  async function updateBatch(input: Parameters<typeof api.batchUpdateManagedNodes>[0], message: string) {
    try {
      const next = await api.batchUpdateManagedNodes(input);
      setNodes(next);
      if (input.prefix || input.find) await onProjectReload();
      setBatchDraft(null);
      onMessage(message);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "批量操作失败");
    }
  }

  async function applyBatch() {
    if (!batchDraft) return;
    await updateBatch({
      ids: [...selected],
      addTags: splitTags(batchDraft.addTags),
      removeTags: splitTags(batchDraft.removeTags),
      prefix: batchDraft.prefix || undefined,
      find: batchDraft.find || undefined,
      replace: batchDraft.replace || undefined,
    }, `已整理 ${selected.size} 个节点`);
  }

  async function toggleEnabled(node: ManagedNode) {
    try {
      const updated = await api.updateManagedNode(node.id, { ...node, enabled: !node.enabled });
      setNodes((current) => current.map((item) => item.id === node.id ? updated : item));
      onMessage(updated.enabled ? "节点已启用" : "节点已停用");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "节点状态更新失败");
    }
  }

  function setBusy(setter: typeof setProbeBusy, id: string, busy: boolean) {
    setter((current) => {
      const next = new Set(current);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function probeNode(node: ManagedNode, announce = false) {
    if (probeMode === "tcp" && ["hysteria2", "tuic", "wireguard"].includes(node.type)) {
      const message = "UDP 节点不支持 TCP 端口检测，请使用代理实测";
      setDiagnostics((current) => ({ ...current, [node.id]: { ...current[node.id], resolvedAddress: null, exitIp: undefined, reachable: undefined, latencyMs: null, error: message, mode: "tcp", probeStatus: "unsupported", checkedAt: new Date().toISOString() } }));
      if (announce) onMessage(message);
      return null;
    }
    setBusy(setProbeBusy, node.id, true);
    try {
      const result = probeMode === "proxy" ? await api.proxyTestManagedNode(node.id) : await api.tcpPingManagedNode(node.id);
      setDiagnostics((current) => ({ ...current, [node.id]: { ...current[node.id], error: undefined, exitIp: undefined, ...result, mode: probeMode, probeStatus: "result", checkedAt: new Date().toISOString() } }));
      if (announce) onMessage(result.reachable ? `${node.name} ${probeMode === "proxy" ? "代理实测" : "TCP 连接"}成功，延迟 ${result.latencyMs}ms` : `${node.name} 无法连接：${result.error || (probeMode === "proxy" ? "代理实测失败" : "TCP 连接失败")}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "检测失败";
      setDiagnostics((current) => ({ ...current, [node.id]: { ...current[node.id], resolvedAddress: null, exitIp: undefined, reachable: undefined, latencyMs: null, error: message, mode: probeMode, probeStatus: "error", checkedAt: new Date().toISOString() } }));
      if (announce) onMessage(message);
      return null;
    } finally {
      setBusy(setProbeBusy, node.id, false);
    }
  }

  async function probeSelectedNodes() {
    const targets = selectedNodes.slice(0, 100);
    if (!targets.length) return;
    const unsupported = probeMode === "tcp" ? targets.filter((node) => ["hysteria2", "tuic", "wireguard"].includes(node.type)) : [];
    let reachable = 0;
    let completed = 0;
    await runLimited(targets, probeMode === "proxy" ? 2 : 4, async (node) => {
      const result = await probeNode(node, false);
      if (result) completed += 1;
      if (result?.reachable) reachable += 1;
    });
    const errors = targets.length - completed - unsupported.length;
    onMessage(`节点检测完成：${completed ? `${reachable}/${completed} 个可连接` : "无可用检测结果"}${errors ? `，${errors} 个检查错误` : ""}${unsupported.length ? `，${unsupported.length} 个不适用` : ""}${selectedNodes.length > 100 ? "，单次最多检测 100 个" : ""}`);
  }

  async function saveRename() {
    if (!renamingNode || !renamingNode.name.trim()) return;
    try {
      const current = nodes.find((node) => node.id === renamingNode.id);
      if (!current) throw new Error("节点已不存在，请刷新节点库后重试");
      await api.updateManagedNode(current.id, { ...current, name: renamingNode.name.trim() });
      await onProjectReload();
      setRenamingNode(null);
      await load(true);
      onMessage("节点名称已更新");
    } catch (err) {
      setRenamingNode(null);
      onMessage(err instanceof Error ? err.message : "重命名节点失败");
    }
  }

  async function selectManualFlag(node: ManagedNode, code: string | null) {
    const newName = replaceNodeCountry(node.name, code);
    try {
      await api.updateManagedNode(node.id, { ...node, name: newName });
      await onProjectReload();
      setFlagPickerNode(null);
      await load(true);
      onMessage(code ? `已将节点地区更新为 [${code}]` : "已清除节点地区国旗");
    } catch (err) {
      setFlagPickerNode(null);
      onMessage(err instanceof Error ? err.message : "更新地区失败");
    }
  }

  async function applyCountryFlag(node: ManagedNode, announce = true) {
    setBusy(setFlagBusy, node.id, true);
    try {
      const basis = (probeMode === "proxy" && diagnostics[node.id]?.exitIp) ? "exit" : "entry";
      const result = await api.applyManagedNodeCountryFlag(node.id, basis);
      setNodes((current) => current.map((item) => item.id === node.id ? result.node : item));
      setDiagnostics((current) => ({ ...current, [node.id]: { ...current[node.id], countryIp: result.location.ip, country: result.location.country, countryCode: result.location.countryCode } }));
      if (announce) {
        await onProjectReload();
        onMessage(`已根据 IP ${result.location.ip} 自动识别为 [${result.location.countryCode}] 国旗`);
      }
      return true;
    } catch (error) {
      if (announce) onMessage(error instanceof Error ? error.message : "国旗识别失败");
      return false;
    } finally {
      setBusy(setFlagBusy, node.id, false);
    }
  }

  async function autoDetectFlag(node: ManagedNode) {
    const success = await applyCountryFlag(node, true);
    if (success) {
      setFlagPickerNode(null);
      await load(true);
    }
  }

  async function previewLinks() {
    if (!linkText.trim()) return;
    setLinkBusy(true);
    setLinkError("");
    try {
      const remote = linkMode === "auto" && /^https?:\/\/\S+$/i.test(linkText.trim());
      const parsed = await api.previewImport(linkText, remote, linkMode);
      setLinkPreview({ nodes: parsed.nodes, warnings: parsed.warnings });
    } catch (error) {
      setLinkPreview(null);
      setLinkError(error instanceof Error ? error.message : "节点链接解析失败");
    } finally {
      setLinkBusy(false);
    }
  }

  async function importLinks() {
    if (!linkPreview?.nodes.length) return;
    setLinkBusy(true);
    try {
      const existing = new Set(nodes.map(nodeFingerprint));
      let imported = 0;
      let duplicates = 0;
      for (const node of linkPreview.nodes) {
        const fingerprint = nodeFingerprint(node);
        if (existing.has(fingerprint)) { duplicates += 1; continue; }
        await api.createManagedNode(node);
        existing.add(fingerprint);
        imported += 1;
      }
      const total = linkPreview.nodes.length;
      setLinkOpen(false);
      setLinkText("");
      setLinkPreview(null);
      await load();
      onMessage(`解析 ${total} 个节点，导入 ${imported} 个，跳过重复 ${duplicates} 个`);
    } catch (error) {
      await load(true);
      onMessage(error instanceof Error ? error.message : "节点导入失败");
    } finally {
      setLinkBusy(false);
    }
  }

  async function reorder(next: ManagedNode[]) {
    const previous = nodes;
    setNodes(next);
    setOrderBusy(true);
    try {
      await api.reorderManagedNodes(next.map((node) => node.id));
    } catch (error) {
      setNodes(previous);
      onMessage(error instanceof Error ? error.message : "节点排序失败");
    } finally {
      setOrderBusy(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!event.over || event.active.id === event.over.id || orderBusy) return;
    const activeIdValue = String(event.active.id).replace(/^node:/, "");
    const overIdValue = String(event.over.id).replace(/^node:/, "");
    const from = visibleIds.indexOf(activeIdValue);
    const to = visibleIds.indexOf(overIdValue);
    if (from < 0 || to < 0) return;
    const reorderedVisible = [...filtered];
    const [moved] = reorderedVisible.splice(from, 1);
    reorderedVisible.splice(to, 0, moved);
    let cursor = 0;
    const visibleSet = new Set(visibleIds);
    const next = nodes.map((node) => visibleSet.has(node.id) ? reorderedVisible[cursor++] : node);
    void reorder(next);
  }

  const toggleSelected = (id: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    checked ? next.add(id) : next.delete(id);
    return next;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every((node) => selected.has(node.id));
  const updateEditing = (key: keyof NodeDraft, value: string | number | boolean | string[]) => setEditing((current) => current ? { ...current, [key]: value } : current);

  return <>
    <div className="view-toolbar node-pool-toolbar" data-guide-id={guideTargets.nodeToolbar}>
      <div className="filter-cluster">
        <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、地址、协议、标签或备注" /></label>
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">全部来源</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select>
      </div>
      <div className="row-actions">
        <button className="secondary-button" onClick={() => void load().catch((error) => onMessage(error.message))} disabled={orderBusy}><RefreshCw size={16} />刷新</button>
        <button className="primary-button" data-guide-id={guideTargets.nodeImport} onClick={() => { setLinkOpen(true); setLinkPreview(null); setLinkError(""); }}><Link2 size={16} />导入链接</button>
        <button className="secondary-button" onClick={() => setEditing({ ...blank })}><Plus size={17} />手动添加</button>
      </div>
    </div>

    <div className="summary-inline node-pool-summary" data-guide-id={guideTargets.nodeSelection}>
      <span><strong>{nodes.length}</strong> 个节点</span><i /><span><strong>{sources.length}</strong> 个来源</span><i /><span><strong>{nodes.filter((node) => node.enabled).length}</strong> 个已启用</span><i /><span><strong>{nodes.filter((node) => projectNodeIds.has(node.id) || projectFingerprints.has(nodeFingerprint(node))).length}</strong> 个在当前项目</span>
      {orderBusy && <><i /><span className="status-ok"><RefreshCw className="spin" size={14} />保存排序中</span></>}
    </div>

    <div className="node-detection-controls" data-guide-id={guideTargets.nodeDiagnostics}>
      <label>
        连通性检测模式
        <select value={probeMode} onChange={(event) => setProbeMode(event.target.value as "tcp" | "proxy")} disabled={probeBusy.size > 0}>
          <option value="tcp">TCP 端口握手检测</option>
          <option value="proxy">代理实测与真实出口 IP</option>
        </select>
      </label>
    </div>
    {selected.size > 0 && <div className="node-selection-actions">
      <span className="selection-count">已选择 <strong>{selected.size}</strong> 个</span>
      <button className="primary-button compact-button" onClick={addSelectedToProject} disabled={orderBusy}><Plus size={15} />加入当前项目</button>
      <button className="secondary-button compact-button" onClick={removeSelectedFromProject} disabled={orderBusy}><Unlink size={15} />移出当前项目</button>
      <button className="secondary-button compact-button" onClick={() => void updateBatch({ ids: [...selected], enabled: true }, `已启用 ${selected.size} 个节点`)}><CheckCircle2 size={15} />启用</button>
      <button className="secondary-button compact-button" onClick={() => void updateBatch({ ids: [...selected], enabled: false }, `已停用 ${selected.size} 个节点`)}><Ban size={15} />停用</button>
      <button className="secondary-button compact-button" disabled={probeBusy.size > 0} onClick={() => void probeSelectedNodes()}>{probeBusy.size ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />}{probeMode === "proxy" ? "代理实测" : "TCP 检测"}</button>
      <button className="secondary-button compact-button" onClick={() => setBatchDraft(emptyBatch())}><WandSparkles size={15} />整理</button>
      <button className="secondary-button compact-button danger-outline" onClick={() => setBatchDeleting(selectedNodes)} disabled={orderBusy}><Trash2 size={15} />删除</button>
    </div>}

    {filtered.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(event) => setActiveId(String(event.active.id).replace(/^node:/, ""))} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleIds.map((id) => `node:${id}`)} strategy={verticalListSortingStrategy}>
        <div className="node-list" data-guide-id={guideTargets.nodeList} role="table" aria-label="节点库">
          <div className="node-list-header" role="row"><span><input type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? new Set([...selected, ...visibleIds]) : new Set([...selected].filter((id) => !visibleIds.includes(id))))} aria-label="选择当前节点" /></span><span>节点</span><span>协议</span><span>服务器</span><span>来源</span><span>标签</span><span>状态</span><span>操作</span></div>
          {filtered.map((node) => <SortableNodeRow key={node.id} node={node} sourceName={node.sourceId ? sourceNames.get(node.sourceId) : undefined} selected={selected.has(node.id)} inProject={projectNodeIds.has(node.id) || projectFingerprints.has(nodeFingerprint(node))} diagnostic={diagnostics[node.id]} probeBusy={probeBusy.has(node.id)} onSelect={(checked) => toggleSelected(node.id, checked)} onToggle={() => void toggleEnabled(node)} onProbe={() => void probeNode(node)} onFlagClick={() => setFlagPickerNode(node)} onRename={() => setRenamingNode({ id: node.id, name: node.name })} onCopyLink={() => void copyNodeLink(node, onMessage)} onDelete={() => setDeleting(node)} />)}
        </div>
      </SortableContext>
      {createPortal(<DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(.16,1,.3,1)" }}>{activeId ? <div className="node-drag-overlay"><GripVertical size={16} /><strong>{nodes.find((node) => node.id === activeId)?.name || "节点"}</strong></div> : null}</DragOverlay>, document.body)}
    </DndContext> : <div className="empty-state" data-guide-id={guideTargets.nodeList}><div className="empty-state-icon"><Database size={24} /></div><h2>{query ? "没有匹配的节点" : "节点库还是空的"}</h2><p>{query ? "换个关键词或来源筛选试试。" : "从订阅、节点链接或手动添加第一个节点。"}</p>{!query && <div className="empty-actions"><button className="primary-button" onClick={() => setLinkOpen(true)}><Link2 size={16} />导入链接</button><button className="secondary-button" onClick={() => setEditing({ ...blank })}><Plus size={17} />手动添加</button></div>}</div>}

    {pageCount > 1 && <div className="pagination-controls"><button className="secondary-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount} · {matchingNodes.length} 个节点</span><button className="secondary-button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    {/* 精致居中动效弹窗：重命名节点 */}
    <Modal
      size="compact"
      open={!!renamingNode}
      onClose={() => setRenamingNode(null)}
      title="重命名节点"
      footer={
        <>
          <button className="secondary-button" onClick={() => setRenamingNode(null)}>取消</button>
          <button className="primary-button" disabled={!renamingNode?.name.trim()} onClick={() => void saveRename()}>保存名称</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <label className="editor-name">
          节点名称
          <input
            value={renamingNode?.name || ""}
            autoFocus
            maxLength={120}
            onChange={(event) => setRenamingNode(renamingNode ? { ...renamingNode, name: event.target.value } : null)}
            onKeyDown={(event) => { if (event.key === "Enter") void saveRename(); }}
          />
        </label>
        <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ink-faint)" }}>
          仅修改节点在管理界面及导出配置中的显示名称，底层服务器、协议与密钥参数保持不变。
        </p>
      </div>
    </Modal>

    {/* 精致居中动效弹窗：国家与地区国旗选择 */}
    <Modal
      size="compact"
      open={!!flagPickerNode}
      onClose={() => setFlagPickerNode(null)}
      title={`选择地区国旗 · ${flagPickerNode?.name || ""}`}
      footer={
        <button className="secondary-button" onClick={() => setFlagPickerNode(null)}>关闭</button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: "var(--radius-md)", background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.2)" }}>
          <div>
            <strong style={{ fontSize: "13px", color: "#ffffff", display: "block" }}>依据 IP 自动识别</strong>
            <small style={{ color: "var(--ink-faint)", fontSize: "11.5px" }}>从节点 IP 查询地理库并自动附加国旗</small>
          </div>
          <button
            className="primary-button compact-button"
            disabled={flagBusy.has(flagPickerNode?.id || "")}
            onClick={() => flagPickerNode && void autoDetectFlag(flagPickerNode)}
          >
            {flagBusy.has(flagPickerNode?.id || "") ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
            自动识别
          </button>
        </div>

        <div>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-soft)", marginBottom: "8px" }}>
            手动选择国家 / 地区
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
            {COMMON_FLAG_LIST.map((item) => (
              <button
                key={item.code}
                type="button"
                className="flag-select-btn"
                onClick={() => flagPickerNode && void selectManualFlag(flagPickerNode, item.code)}
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
                  transition: "all var(--duration-fast) ease",
                }}
              >
                <CountryFlag code={item.code} />
                <span>{item.name}</span>
                <small style={{ marginLeft: "auto", color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>{item.code}</small>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "8px", borderTop: "1px solid var(--line)" }}>
          <button
            type="button"
            className="text-button"
            onClick={() => flagPickerNode && void selectManualFlag(flagPickerNode, null)}
            style={{ color: "var(--danger)", fontSize: "12px" }}
          >
            清除地区国旗
          </button>
        </div>
      </div>
    </Modal>

    {/* 手动添加新节点弹窗 */}
    <Modal open={!!editing && !editing.id} onClose={() => setEditing(null)} title="手动添加节点" footer={<><button className="secondary-button" onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={!editing || !editing.name.trim() || !editing.server.trim() || !Number.isInteger(editing.port) || editing.port < 1 || editing.port > 65535} onClick={() => void save()}>保存节点</button></>}>
      <div className="form-grid">
        <label className="span-2">节点名称<input value={editing?.name || ""} onChange={(event) => updateEditing("name", event.target.value)} /></label>
        <label>协议<select value={editing?.type || "ss"} onChange={(event) => updateEditing("type", event.target.value)}>{["ss", "ssr", "vmess", "vless", "trojan", "hysteria2", "tuic", "snell", "wireguard", "socks5", "http"].map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>端口<input type="number" min={1} max={65535} value={editing?.port || 443} onChange={(event) => updateEditing("port", Number(event.target.value))} /></label>
        <label className="span-2">服务器<input value={editing?.server || ""} onChange={(event) => updateEditing("server", event.target.value)} /></label>
        <label>UUID / 用户名<input value={editing?.uuid || ""} onChange={(event) => updateEditing("uuid", event.target.value)} /></label>
        <label>密码<input type="password" autoComplete="off" value={editing?.password || ""} onChange={(event) => updateEditing("password", event.target.value)} /></label>
        <label>加密方式<input value={editing?.cipher || ""} onChange={(event) => updateEditing("cipher", event.target.value)} placeholder="例如 aes-128-gcm" /></label>
        <label>传输方式<input value={editing?.network || ""} onChange={(event) => updateEditing("network", event.target.value)} placeholder="tcp / ws / grpc" /></label>
        <label className="span-2">SNI / Server Name<input value={editing?.sni || ""} onChange={(event) => updateEditing("sni", event.target.value)} /></label>
        <label>WS 路径<input value={editing?.wsPath || ""} onChange={(event) => updateEditing("wsPath", event.target.value)} /></label>
        <label>WS Host<input value={editing?.wsHost || ""} onChange={(event) => updateEditing("wsHost", event.target.value)} /></label>
        <label className="span-2">gRPC Service Name<input value={editing?.grpcServiceName || ""} onChange={(event) => updateEditing("grpcServiceName", event.target.value)} /></label>
        <label className="span-2">标签<input value={(editing?.tags || []).join("，")} onChange={(event) => updateEditing("tags", splitTags(event.target.value))} placeholder="香港，流媒体，低延迟" /></label>
        <label className="span-2">备注<textarea rows={3} value={editing?.note || ""} onChange={(event) => updateEditing("note", event.target.value)} placeholder="仅自己可见的节点说明" /></label>
        <label className="toggle-row span-2"><span><strong>启用节点</strong><small>停用后仍保留数据，但生成方案可快速排除</small></span><input type="checkbox" checked={editing?.enabled !== false} onChange={(event) => updateEditing("enabled", event.target.checked)} /></label>
        <label className="toggle-row span-2"><span><strong>UDP</strong><small>允许该节点承载 UDP 流量</small></span><input type="checkbox" checked={!!editing?.udp} onChange={(event) => updateEditing("udp", event.target.checked)} /></label>
        <label className="toggle-row span-2"><span><strong>TLS</strong><small>启用加密传输</small></span><input type="checkbox" checked={!!editing?.tls} onChange={(event) => updateEditing("tls", event.target.checked)} /></label>
        <label className="toggle-row span-2"><span><strong>跳过证书校验</strong><small>仅在确认服务端配置时使用</small></span><input type="checkbox" checked={!!editing?.skipCertVerify} onChange={(event) => updateEditing("skipCertVerify", event.target.checked)} /></label>
      </div>
      <p className="form-hint"><Pencil size={15} />协议链接导入会自动填充更多专属参数；未填写的可选字段不会写入导出配置。</p>
    </Modal>

    <Drawer open={!!batchDraft} onClose={() => setBatchDraft(null)} title={`批量整理 ${selected.size} 个节点`} footer={<><button className="secondary-button" onClick={() => setBatchDraft(null)}>取消</button><button className="primary-button" onClick={() => void applyBatch()}><WandSparkles size={16} />应用整理</button></>}>
      {batchDraft && <div className="form-grid batch-node-form">
        <label className="span-2">添加标签<input value={batchDraft.addTags} onChange={(event) => setBatchDraft({ ...batchDraft, addTags: event.target.value })} placeholder="流媒体，低延迟" /></label>
        <label className="span-2">移除标签<input value={batchDraft.removeTags} onChange={(event) => setBatchDraft({ ...batchDraft, removeTags: event.target.value })} placeholder="旧标签" /></label>
        <label className="span-2">名称前缀<input value={batchDraft.prefix} onChange={(event) => setBatchDraft({ ...batchDraft, prefix: event.target.value })} placeholder="例如 HK · " /></label>
        <label>查找文字<input value={batchDraft.find} onChange={(event) => setBatchDraft({ ...batchDraft, find: event.target.value })} /></label>
        <label>替换为<input value={batchDraft.replace} onChange={(event) => setBatchDraft({ ...batchDraft, replace: event.target.value })} /></label>
        <div className="form-hint span-2"><Tags size={15} />标签使用逗号、中文逗号或换行分隔；留空的操作不会修改原值。</div>
      </div>}
    </Drawer>

    <Drawer size="compact" open={linkOpen} onClose={() => { setLinkOpen(false); setLinkPreview(null); }} title="导入节点链接" footer={<><button className="secondary-button" onClick={() => { setLinkOpen(false); setLinkPreview(null); }}>取消</button>{linkPreview ? <button className="primary-button" disabled={linkBusy || !linkPreview.nodes.length} onClick={() => void importLinks()}>{linkBusy ? <RefreshCw className="spin" size={16} /> : <FilePlus2 size={16} />}导入预览节点</button> : <button className="primary-button" disabled={linkBusy || !linkText.trim()} onClick={() => void previewLinks()}>{linkBusy ? <RefreshCw className="spin" size={16} /> : <Search size={16} />}解析预览</button>}</>}>
      <label>输入类型<select disabled={linkBusy} value={linkMode} onChange={(event) => { setLinkMode(event.target.value as "auto" | "links"); setLinkPreview(null); setLinkError(""); }}><option value="auto">自动识别（HTTP 地址按订阅 URL 获取）</option><option value="links">节点协议链接（含 HTTP 代理） / Base64</option></select></label>
      <label className="import-textarea">订阅 URL 或节点链接<textarea autoFocus disabled={linkBusy} value={linkText} onChange={(event) => { setLinkText(event.target.value); setLinkPreview(null); setLinkError(""); }} placeholder={"https://example.com/subscribe\n或一行一个 vless://、vmess://、ss:// 链接"} spellCheck={false} /></label>
      {linkError && <p className="form-error" role="alert">{linkError}</p>}
      {linkPreview && <div className="import-preview"><strong>解析结果：{linkPreview.nodes.length} 个节点</strong>{linkPreview.nodes.slice(0, 8).map((node) => <div key={node.id}><span>{node.name}</span><small>{node.type.toUpperCase()} · {node.server}:{node.port}</small></div>)}{linkPreview.nodes.length > 8 && <small>还有 {linkPreview.nodes.length - 8} 个节点</small>}{linkPreview.warnings.length > 0 && <div className="import-warnings"><strong>以下内容未识别：</strong>{linkPreview.warnings.slice(0, 12).map((warning, index) => <small key={`${warning}-${index}`}>{warning}</small>)}{linkPreview.warnings.length > 12 && <small>还有 {linkPreview.warnings.length - 12} 条</small>}</div>}</div>}
      <p className="form-hint"><Link2 size={15} />预览不会写入节点库。确认后导入所见节点；需要定时同步，请在「订阅来源」添加远程来源。</p><button className="text-button" onClick={onOpenSources}>前往订阅来源设置自动同步</button>
    </Drawer>

    <ConfirmDialog open={!!batchDeleting} title="批量删除节点" message={`将永久删除 ${batchDeleting?.length || 0} 个节点，并清理项目引用。此操作无法撤销。`} onClose={() => setBatchDeleting(null)} onConfirm={async () => { if (batchDeleting) await deleteNodes(batchDeleting); setBatchDeleting(null); }} />
    <ConfirmDialog open={!!deleting} title="删除节点" message={`确定从节点库删除“${deleting?.name}”吗？如果当前项目正在使用它，相关分组引用也会一并清理。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; await deleteNodes([deleting]); setDeleting(null); }} />
  </>;
}

async function copyNodeLink(node: ManagedNode, onMessage: (message: string) => void) {
  try {
    const link = serializeShareLink(proxyFromManaged(node));
    if (!link) {
      onMessage("该节点暂时无法生成兼容的协议链接，请检查协议与必填参数");
      return;
    }
    await copyText(link);
    onMessage("节点协议链接已复制");
  } catch (error) {
    onMessage(error instanceof Error ? error.message : "复制协议链接失败");
  }
}

function SortableNodeRow({ node, sourceName, selected, inProject, diagnostic, probeBusy, onSelect, onToggle, onProbe, onFlagClick, onRename, onCopyLink, onDelete }: {
  node: ManagedNode;
  sourceName?: string;
  selected: boolean;
  inProject: boolean;
  diagnostic?: NodeDiagnostic;
  probeBusy: boolean;
  onSelect: (checked: boolean) => void;
  onToggle: () => void;
  onProbe: () => void;
  onFlagClick: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `node:${node.id}`, data: { kind: "managed-node", nodeId: node.id } });
  return <div ref={setNodeRef} className={`node-row${isDragging ? " dragging" : ""}${node.enabled ? "" : " is-disabled"}`} style={{ transform: CSS.Transform.toString(transform), transition }} role="row">
    <span className="node-row-check">
      <button ref={setActivatorNodeRef} className="drag-handle" {...listeners} {...attributes} aria-label={`拖动节点 ${node.name}`} title="拖拽排序"><GripVertical size={15} /></button>
      <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`选择 ${node.name}`} />
    </span>
    <span className="node-row-name">
      <span className="entity-icon"><Server size={15} /></span>
      <span className="node-name-stack">
        <strong title={node.name} style={{ display: "inline-flex", alignItems: "center", maxWidth: "100%" }}>
          <FormattedNodeName name={node.name} onFlagClick={onFlagClick} />
        </strong>
        {inProject && <small className="node-in-project-badge"><CheckCircle2 size={11} /> 当前项目</small>}
        {diagnostic && (diagnostic.exitIp || diagnostic.country) && <small className="node-diagnostic location" title={diagnostic.countryIp || diagnostic.resolvedAddress || undefined}><MapPin size={11} />{diagnostic.country ? `${diagnostic.country}${diagnostic.countryIp ? ` · ${diagnostic.countryIp}` : ""}` : `出口 ${diagnostic.exitIp}`}</small>}
        {node.note && <small className="node-note" title={node.note}>{node.note}</small>}
      </span>
    </span>
    <span className="node-row-type"><span className="type-badge">{node.type.toUpperCase()}</span></span>
    <span className="node-row-server mono" title={`${node.server}:${node.port}`}>{node.server}:{node.port}</span>
    <span className="node-row-source" title={sourceName || "手动添加"}>{sourceName || "手动添加"}</span>
    <span className="node-row-tags" title={node.tags.join("、")}>
      {node.tags.length ? node.tags.map((tag) => <span key={tag} className="node-tag-pill">{tag}</span>) : <span className="empty-dash">-</span>}
    </span>
    <span className="node-row-status">
      <button className={node.enabled ? "status-toggle active" : "status-toggle"} onClick={onToggle} title={node.enabled ? "点击停用" : "点击启用"}>
        {node.enabled ? <CheckCircle2 size={13} /> : <Ban size={13} />}
        <span>{node.enabled ? "已启用" : "已停用"}</span>
      </button>
    </span>
    <span className="node-row-actions" role="group" aria-label={`${node.name} 的节点操作`}>
      <button className="node-tool-btn" disabled={probeBusy} onClick={onProbe} title="连通性测速" aria-label={`检测节点 ${node.name}`}>
        {probeBusy ? <LoaderCircle className="spin" size={14} /> : <Activity size={14} />}
        {diagnostic?.reachable === true && diagnostic.latencyMs !== null && diagnostic.latencyMs !== undefined ? (
          <span className={`tcp-latency-badge ${latencyLevel(diagnostic.latencyMs)}`}>{diagnostic.latencyMs}ms</span>
        ) : diagnostic?.reachable === false && diagnostic.probeStatus === "result" ? (
          <span className="tcp-latency-badge bad">超时</span>
        ) : (
          <span className="node-btn-text">测速</span>
        )}
      </button>
      <button className="node-icon-action-btn" onClick={onCopyLink} title="复制节点链接" aria-label={`复制 ${node.name} 的协议链接`}>
        <Copy size={14} />
      </button>
      <button className="node-icon-action-btn" onClick={onRename} title="重命名节点" aria-label={`重命名 ${node.name}`}>
        <Pencil size={14} />
      </button>
      <button className="node-icon-action-btn danger" onClick={onDelete} title="删除节点" aria-label={`删除 ${node.name}`}>
        <Trash2 size={14} />
      </button>
    </span>
  </div>;
}
