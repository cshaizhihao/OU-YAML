import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronDown, Gauge, GripVertical, Group, Network, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { createId } from "../../shared/id";
import { addGroupMembers, moveGroupMember, removeGroupMember, reorderGroupMember } from "../../shared/grouping";
import type { GroupType, MihomoConfig, ProxyGroup, ProxyNode } from "../../shared/types";
import { ConfirmDialog, Drawer } from "../Dialog";

const groupTypes: { value: GroupType; label: string }[] = [
  { value: "select", label: "手动选择" },
  { value: "url-test", label: "自动测速" },
  { value: "fallback", label: "故障转移" },
  { value: "load-balance", label: "负载均衡" },
  { value: "relay", label: "链式代理" },
];
const blankGroup = (): ProxyGroup => ({ id: createId(), name: "新策略组", type: "select", proxies: ["DIRECT"], extra: {} });
const memberId = (groupId: string, name: string) => JSON.stringify(["member", groupId, name]);
const groupId = (id: string) => JSON.stringify(["group", id]);
type DragPayload = { kind: "pool"; name: string } | { kind: "member"; name: string; groupId: string } | { kind: "group"; groupId: string };
const boardCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (!collisions.length) return closestCenter(args);
  const member = collisions.find((collision) => collision.data?.droppableContainer.data.current?.kind === "member");
  return member ? [member] : collisions;
};

export function GroupsView({ config, onChange }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void }) {
  const [editing, setEditing] = useState<ProxyGroup | null>(null);
  const [deleting, setDeleting] = useState<ProxyGroup | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(config.proxyGroups[0]?.id || "");
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [activeName, setActiveName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nodes = useMemo(() => config.proxies.filter((node) => `${node.name} ${node.server} ${node.type}`.toLowerCase().includes(query.toLowerCase())), [config.proxies, query]);
  const selectedGroup = config.proxyGroups.find((group) => group.id === selectedGroupId) || config.proxyGroups[0];

  function updateGroups(proxyGroups: ProxyGroup[]) { onChange({ ...config, proxyGroups }); }
  function save(group: ProxyGroup) {
    const exists = config.proxyGroups.some((item) => item.id === group.id);
    updateGroups(exists ? config.proxyGroups.map((item) => item.id === group.id ? group : item) : [...config.proxyGroups, group]);
    if (!exists) setSelectedGroupId(group.id);
    setEditing(null);
  }
  function addMembers(targetGroupId: string, names: string[], before?: string) {
    updateGroups(addGroupMembers(config.proxyGroups, targetGroupId, names, before));
  }
  function removeMember(targetGroupId: string, name: string) {
    updateGroups(removeGroupMember(config.proxyGroups, targetGroupId, name));
  }
  function toggleNode(name: string) {
    setSelectedNodes((current) => { const next = new Set(current); next.has(name) ? next.delete(name) : next.add(name); return next; });
  }
  function handleDragStart(event: DragStartEvent) {
    const payload = event.active.data.current as DragPayload | undefined;
    setActiveName(payload && "name" in payload ? payload.name : "");
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveName("");
    if (!event.over) return;
    const active = event.active.data.current as DragPayload | undefined;
    const over = event.over.data.current as DragPayload | undefined;
    if (!active || !over || active.kind === "group") return;
    const targetGroupId = over.kind === "group" ? over.groupId : over.kind === "member" ? over.groupId : undefined;
    if (!targetGroupId) return;
    const before = over.kind === "member" ? over.name : undefined;
    if (active.kind === "pool") { addMembers(targetGroupId, [active.name], before); setSelectedGroupId(targetGroupId); return; }
    if (active.groupId === targetGroupId) {
      if (!before || before === active.name) return;
      updateGroups(reorderGroupMember(config.proxyGroups, targetGroupId, active.name, before));
      return;
    }
    updateGroups(moveGroupMember(config.proxyGroups, active.groupId, targetGroupId, active.name, before));
    setSelectedGroupId(targetGroupId);
  }

  return <>
    <div className="view-toolbar group-board-toolbar"><div className="summary-inline"><span><strong>{config.proxies.length}</strong> 个节点</span><i /><span><strong>{config.proxyGroups.length}</strong> 个策略组</span><i /><span><strong>{config.proxyGroups.reduce((sum, item) => sum + item.proxies.length, 0)}</strong> 个引用</span></div><button className="primary-button" onClick={() => setEditing(blankGroup())}><Plus size={17} />添加策略组</button></div>
    <DndContext sensors={sensors} collisionDetection={boardCollisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveName("")}>
      <div className="group-board">
        <aside className="node-pool" aria-label="节点池">
          <header><div><Network size={18} /><strong>节点池</strong></div><span>{nodes.length}</span></header>
          <label className="board-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" aria-label="搜索节点池" /></label>
          {!!config.proxyGroups.length && <div className="pool-target"><label>加入到<div><select value={selectedGroup?.id || ""} onChange={(event) => setSelectedGroupId(event.target.value)}>{config.proxyGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><ChevronDown size={14} /></div></label><button className="secondary-button compact-button" disabled={!selectedNodes.size || !selectedGroup} onClick={() => { if (!selectedGroup) return; addMembers(selectedGroup.id, [...selectedNodes]); setSelectedNodes(new Set()); }}><Plus size={15} />加入所选 {selectedNodes.size || ""}</button></div>}
          <div className="node-pool-list">{nodes.map((node) => <PoolNode key={node.id} node={node} selected={selectedNodes.has(node.name)} targetName={selectedGroup?.name} onToggle={() => toggleNode(node.name)} onAdd={() => selectedGroup && addMembers(selectedGroup.id, [node.name])} />)}{!nodes.length && <div className="pool-empty">{config.proxies.length ? "没有匹配节点" : "先从订阅或节点页导入节点"}</div>}</div>
        </aside>

        <section className="group-canvas" aria-label="策略组编排区">
          {config.proxyGroups.map((group) => <GroupColumn key={group.id} group={group} config={config} selected={group.id === selectedGroup?.id} onSelect={() => setSelectedGroupId(group.id)} onEdit={() => setEditing(structuredClone(group))} onDelete={() => setDeleting(group)} onRemove={(name) => removeMember(group.id, name)} onAddBuiltin={(name) => addMembers(group.id, [name])} />)}
          {!config.proxyGroups.length && <button className="empty-group-column" onClick={() => setEditing(blankGroup())}><Plus size={22} /><strong>创建第一个策略组</strong></button>}
        </section>
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>{activeName ? <div className="drag-overlay"><GripVertical size={16} /><strong>{activeName}</strong></div> : null}</DragOverlay>
    </DndContext>
    <GroupEditor key={editing?.id || "closed"} config={config} group={editing} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除策略组" message={`确定删除“${deleting?.name}”吗？引用该组的规则会变为无效。`} onClose={() => setDeleting(null)} onConfirm={() => { if (deleting) updateGroups(config.proxyGroups.filter((item) => item.id !== deleting.id)); setDeleting(null); }} />
  </>;
}

function PoolNode({ node, selected, targetName, onToggle, onAdd }: { node: ProxyNode; selected: boolean; targetName?: string; onToggle: () => void; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `pool:${node.id}`, data: { kind: "pool", name: node.name } satisfies DragPayload });
  return <article ref={setNodeRef} className={isDragging ? "pool-node dragging" : "pool-node"} style={{ transform: CSS.Translate.toString(transform) }}><button ref={setActivatorNodeRef} className="drag-handle" {...listeners} {...attributes} aria-label={`拖动节点 ${node.name}`}><GripVertical size={17} /></button><label className="pool-check"><input type="checkbox" checked={selected} onChange={onToggle} /><span className="sr-only">选择 {node.name}</span></label><div className="pool-node-main"><strong title={node.name}>{node.name}</strong><span>{node.type.toUpperCase()} · {node.server || "未设置地址"}</span></div><button className="icon-button compact add-to-group" disabled={!targetName} onClick={onAdd} title={targetName ? `加入 ${targetName}` : "请先创建策略组"} aria-label={targetName ? `将 ${node.name} 加入 ${targetName}` : "请先创建策略组"}><Plus size={16} /></button></article>;
}

function GroupColumn({ group, config, selected, onSelect, onEdit, onDelete, onRemove, onAddBuiltin }: { group: ProxyGroup; config: MihomoConfig; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void; onRemove: (name: string) => void; onAddBuiltin: (name: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: groupId(group.id), data: { kind: "group", groupId: group.id } satisfies DragPayload });
  return <article ref={setNodeRef} className={`group-column${selected ? " selected" : ""}${isOver ? " over" : ""}`} onClick={onSelect}>
    <header className="group-column-header"><span className="group-icon">{group.type === "url-test" ? <Gauge size={19} /> : <Group size={19} />}</span><div><h2>{group.name}</h2><span>{groupTypes.find((item) => item.value === group.type)?.label || group.type}</span></div><b>{group.proxies.length}</b><button className="icon-button compact" onClick={(event) => { event.stopPropagation(); onEdit(); }} aria-label={`编辑 ${group.name}`}><Pencil size={15} /></button><button className="icon-button compact danger" onClick={(event) => { event.stopPropagation(); onDelete(); }} aria-label={`删除 ${group.name}`}><Trash2 size={15} /></button></header>
    <SortableContext items={group.proxies.map((name) => memberId(group.id, name))} strategy={verticalListSortingStrategy}><div className="group-member-list">{group.proxies.map((name) => <SortableMember key={name} name={name} groupId={group.id} node={config.proxies.find((item) => item.name === name)} nestedGroup={config.proxyGroups.find((item) => item.name === name)} onRemove={() => onRemove(name)} />)}{!group.proxies.length && <div className="group-drop-empty"><Network size={18} /><span>拖动节点到这里</span></div>}</div></SortableContext>
    <footer className="group-quick-add"><span>快速加入</span>{["DIRECT", "REJECT"].map((name) => <button key={name} disabled={group.proxies.includes(name)} onClick={(event) => { event.stopPropagation(); onAddBuiltin(name); }}>{group.proxies.includes(name) ? <Check size={13} /> : <Plus size={13} />}{name}</button>)}</footer>
  </article>;
}

function SortableMember({ name, groupId: ownerId, node, nestedGroup, onRemove }: { name: string; groupId: string; node?: ProxyNode; nestedGroup?: ProxyGroup; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: memberId(ownerId, name), data: { kind: "member", name, groupId: ownerId } satisfies DragPayload });
  return <div ref={setNodeRef} className={isDragging ? "group-member dragging" : "group-member"} style={{ transform: CSS.Transform.toString(transform), transition }}><button ref={setActivatorNodeRef} className="drag-handle" {...listeners} {...attributes} aria-label={`拖动成员 ${name}`}><GripVertical size={16} /></button><span className={`member-kind ${node ? "node" : nestedGroup ? "group" : "builtin"}`}>{node ? node.type.slice(0, 2).toUpperCase() : nestedGroup ? <Group size={13} /> : name.slice(0, 1)}</span><div><strong title={name}>{name}</strong><span>{node ? node.server : nestedGroup ? "策略组" : "内置策略"}</span></div><button className="icon-button compact" onClick={onRemove} aria-label={`从策略组移除 ${name}`}><X size={15} /></button></div>;
}

function GroupEditor({ config, group, onClose, onSave }: { config: MihomoConfig; group: ProxyGroup | null; onClose: () => void; onSave: (group: ProxyGroup) => void }) {
  const [draft, setDraft] = useState<ProxyGroup | null>(group);
  if (!group || !draft) return null;
  const memberOptions = ["DIRECT", "REJECT", ...config.proxies.map((item) => item.name), ...config.proxyGroups.filter((item) => item.id !== draft.id).map((item) => item.name)];
  const toggleMember = (member: string) => setDraft({ ...draft, proxies: draft.proxies.includes(member) ? draft.proxies.filter((item) => item !== member) : [...draft.proxies, member] });
  return <Drawer title={group.name === "新策略组" ? "添加策略组" : `编辑 ${group.name}`} open onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>保存策略组</button></>}>
    <div className="form-grid"><label className="span-2">策略组名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="span-2">类型<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as GroupType })}>{groupTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{draft.type !== "select" && draft.type !== "relay" && <><label className="span-2">测速 URL<input value={draft.url || "https://www.gstatic.com/generate_204"} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label><label>间隔（秒）<input type="number" min={10} value={draft.interval || 300} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /></label><label>容差（毫秒）<input type="number" min={0} value={draft.tolerance || 50} onChange={(event) => setDraft({ ...draft, tolerance: Number(event.target.value) })} /></label></>}</div>
    <fieldset className="member-selector"><legend>成员</legend><div className="member-options">{memberOptions.map((member) => <label key={member}><input type="checkbox" checked={draft.proxies.includes(member)} onChange={() => toggleMember(member)} /><span>{member}</span></label>)}</div></fieldset>
  </Drawer>;
}
