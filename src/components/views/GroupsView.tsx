import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, CircleHelp, GitBranch, GripVertical, Group, Maximize2, Minimize2, Network, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { createId } from "../../shared/id";
import { guideTargets } from "../../guides/registry";
import { addGroupMembers, canAddGroupMember, canDropGroupItem, hasGroupCycle, moveGroupMember, removeGroupMember, reorderGroupMember, reorderGroups, type GroupDragData, type GroupDropData } from "../../shared/grouping";
import { ruleTargetLabel } from "../../shared/ruleCatalog";
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
const groupId = (id: string) => JSON.stringify(["group-reorder", id]);
const groupTargetId = (id: string) => JSON.stringify(["group-target", id]);
const overviewTargetId = (id: string) => JSON.stringify(["group-overview-target", id]);

export function GroupsView({ config, onChange, onMessage, nextAction }: { config: MihomoConfig; onChange: (config: MihomoConfig) => void; onMessage?: (message: string) => void; nextAction?: ReactNode }) {
  const [editing, setEditing] = useState<ProxyGroup | null>(null);
  const [deleting, setDeleting] = useState<ProxyGroup | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(config.proxyGroups[0]?.id || "");
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [activeName, setActiveName] = useState("");
  const [activeKind, setActiveKind] = useState<GroupDragData["kind"] | "">("");
  const [focusMode, setFocusMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"overview" | "canvas" | "pool">("canvas");
  const focusShellRef = useRef<HTMLDivElement | null>(null);
  const keyboardTarget = useRef<UniqueIdentifier | null>(null);
  const nodes = useMemo(() => config.proxies.filter((node) => `${node.name} ${node.server} ${node.type}`.toLowerCase().includes(query.toLowerCase())), [config.proxies, query]);
  const nodeNames = useMemo(() => new Set(config.proxies.map((node) => node.name)), [config.proxies]);
  const selectedGroup = config.proxyGroups.find((group) => group.id === selectedGroupId) || config.proxyGroups[0];
  const accepts = (active: GroupDragData, over?: GroupDropData) => !!over && canDropGroupItem(config.proxyGroups, active, over, nodeNames);
  const boardCollisionDetection: CollisionDetection = (args) => {
    const active = args.active.data.current as GroupDragData | undefined;
    if (!active) return [];
    const droppableContainers = args.droppableContainers.filter((container) => container.node.current?.getClientRects().length && accepts(active, container.data.current as GroupDropData));
    const eligible = { ...args, droppableContainers };
    if (!args.pointerCoordinates) return closestCenter({ ...eligible, droppableContainers: droppableContainers.filter((container) => container.id === keyboardTarget.current) });
    const collisions = pointerWithin(eligible);
    if (active.kind === "group-reorder") return collisions.slice(0, 1);
    const member = collisions.find((collision) => collision.data?.droppableContainer.data.current?.kind === "member");
    if (member) return [member];
    const groupTarget = collisions.find((collision) => collision.data?.droppableContainer.data.current?.kind === "group-target");
    return groupTarget ? [groupTarget] : [];
  };
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) return;
    event.preventDefault();
    const { active, collisionRect, droppableContainers, droppableRects, over } = context;
    if (!active || !collisionRect) return;
    const payload = active.data.current as GroupDragData;
    if (payload.kind === "group-reorder") {
      const currentId = keyboardTarget.current || active.id;
      const currentIndex = config.proxyGroups.findIndex((group) => groupId(group.id) === currentId);
      const direction = event.code === "ArrowDown" || event.code === "ArrowRight" ? 1 : -1;
      const targetGroup = config.proxyGroups[currentIndex + direction];
      if (!targetGroup) return;
      const targetId = groupId(targetGroup.id);
      const target = droppableContainers.get(targetId);
      const rect = droppableRects.get(targetId);
      if (!rect || !target?.node.current?.getClientRects().length) return;
      keyboardTarget.current = targetId;
      target.node.current.scrollIntoView({ block: "nearest", inline: "nearest" });
      return { x: currentCoordinates.x + rect.left - collisionRect.left, y: currentCoordinates.y + rect.top - collisionRect.top };
    }
    const origin = over?.rect || collisionRect;
    const originX = origin.left + origin.width / 2;
    const originY = origin.top + origin.height / 2;
    const candidates = droppableContainers.getEnabled().flatMap((container) => {
      const rect = droppableRects.get(container.id);
      if (!rect?.width || !rect.height || !container.node.current?.getClientRects().length || container.id === over?.id || (container.id !== active.id && !accepts(payload, container.data.current as GroupDropData))) return [];
      const deltaX = rect.left + rect.width / 2 - originX;
      const deltaY = rect.top + rect.height / 2 - originY;
      const forward = event.code === "ArrowDown" ? deltaY : event.code === "ArrowUp" ? -deltaY : event.code === "ArrowRight" ? deltaX : -deltaX;
      if (forward <= 1) return [];
      const sideways = event.code === "ArrowDown" || event.code === "ArrowUp" ? deltaX : deltaY;
      return [{ container, rect, distance: forward * forward + sideways * sideways * 4 }];
    }).sort((first, second) => first.distance - second.distance);
    const target = candidates[0];
    if (!target) return;
    keyboardTarget.current = target.container.id;
    target.container.node.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return { x: currentCoordinates.x + target.rect.left + target.rect.width / 2 - collisionRect.left - collisionRect.width / 2, y: currentCoordinates.y + target.rect.top + target.rect.height / 2 - collisionRect.top - collisionRect.height / 2 };
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: "auto" }),
  );

  useEffect(() => {
    if (selectedGroupId && config.proxyGroups.some((group) => group.id === selectedGroupId)) return;
    setSelectedGroupId(config.proxyGroups[0]?.id || "");
  }, [config.proxyGroups, selectedGroupId]);

  useEffect(() => {
    if (!focusMode) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...(focusShellRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])" ) || [])].filter((element) => element.getClientRects().length > 0);
    const focusTimer = window.setTimeout(() => (focusable()[0] || focusShellRef.current)?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !focusShellRef.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") { event.preventDefault(); setFocusMode(false); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      if (previous?.isConnected) previous.focus();
    };
  }, [focusMode]);

  function updateGroups(proxyGroups: ProxyGroup[]) { onChange({ ...config, proxyGroups }); }
  function save(group: ProxyGroup) {
    const normalized = {
      ...group,
      name: group.name.trim(),
      proxies: [...new Set(group.proxies)].filter((member) => group.type !== "relay" || config.proxies.some((node) => node.name === member)),
    };
    if (!normalized.name) { onMessage?.("策略组名称不能为空"); return; }
    if (config.proxyGroups.some((item) => item.id !== normalized.id && item.name === normalized.name)) { onMessage?.("策略组名称不能重复"); return; }
    const previous = config.proxyGroups.find((item) => item.id === normalized.id);
    const exists = !!previous;
    let nextGroups = exists ? config.proxyGroups.map((item) => item.id === normalized.id ? normalized : item) : [...config.proxyGroups, normalized];
    if (previous && previous.name !== normalized.name) {
      nextGroups = nextGroups.map((item) => item.id === normalized.id ? item : { ...item, proxies: item.proxies.map((member) => member === previous.name ? normalized.name : member) });
    }
    if (hasGroupCycle(nextGroups)) { onMessage?.("不能保存：策略组会形成循环引用"); return; }
    onChange({ ...config, proxyGroups: nextGroups, rules: previous && previous.name !== normalized.name ? config.rules.map((rule) => rule.target === previous.name ? { ...rule, target: normalized.name } : rule) : config.rules });
    if (!exists) setSelectedGroupId(group.id);
    setMobilePanel("canvas");
    setEditing(null);
  }
  function addMembers(targetGroupId: string, names: string[], before?: string) {
    const allowed = names.filter((name) => canAddGroupMember(config.proxyGroups, targetGroupId, name, nodeNames));
    if (allowed.length !== names.length) onMessage?.("部分成员不能加入当前策略组：链式代理只能放真实节点，普通策略组不能形成循环");
    if (allowed.length) updateGroups(addGroupMembers(config.proxyGroups, targetGroupId, allowed, before, nodeNames));
  }
  function removeMember(targetGroupId: string, name: string) {
    updateGroups(removeGroupMember(config.proxyGroups, targetGroupId, name));
  }
  function moveGroup(groupIdValue: string, direction: -1 | 1) {
    const index = config.proxyGroups.findIndex((group) => group.id === groupIdValue);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= config.proxyGroups.length) return;
    const next = [...config.proxyGroups];
    [next[index], next[target]] = [next[target], next[index]];
    updateGroups(next);
  }
  function moveMemberBy(groupIdValue: string, name: string, direction: -1 | 1) {
    updateGroups(config.proxyGroups.map((group) => {
      if (group.id !== groupIdValue) return group;
      const index = group.proxies.indexOf(name);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= group.proxies.length) return group;
      const proxies = [...group.proxies];
      [proxies[index], proxies[target]] = [proxies[target], proxies[index]];
      return { ...group, proxies };
    }));
  }
  function toggleNode(name: string) {
    setSelectedNodes((current) => { const next = new Set(current); next.has(name) ? next.delete(name) : next.add(name); return next; });
  }
  function handleDragStart(event: DragStartEvent) {
    keyboardTarget.current = event.active.id;
    const payload = event.active.data.current as GroupDragData | undefined;
    setActiveName(payload && "name" in payload ? payload.name : "");
    setActiveKind(payload?.kind || "");
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveName("");
    setActiveKind("");
    if (!event.over) return;
    const active = event.active.data.current as GroupDragData | undefined;
    const over = event.over.data.current as GroupDropData | undefined;
    if (!active || !over || !accepts(active, over)) return;
    if (active.kind === "group-reorder" && over.kind === "group-reorder") {
      const from = config.proxyGroups.findIndex((group) => group.id === active.groupId);
      const to = config.proxyGroups.findIndex((group) => group.id === over.groupId);
      updateGroups(reorderGroups(config.proxyGroups, active.groupId, over.groupId, from < to ? "after" : "before"));
      return;
    }
    if (over.kind !== "group-target" && over.kind !== "member") return;
    const targetGroupId = over.groupId;
    const before = over.kind === "member" ? over.name : undefined;
    if (active.kind === "pool" || active.kind === "group-nest") { addMembers(targetGroupId, [active.name], before); return; }
    if (active.kind !== "member") return;
    if (active.groupId === targetGroupId) {
      const members = config.proxyGroups.find((group) => group.id === targetGroupId)!.proxies;
      updateGroups(reorderGroupMember(config.proxyGroups, targetGroupId, active.name, before || "", before && members.indexOf(active.name) < members.indexOf(before) ? "after" : "before"));
      return;
    }
    updateGroups(moveGroupMember(config.proxyGroups, active.groupId, targetGroupId, active.name, before, nodeNames));
  }

  return <>
    <DndContext sensors={sensors} collisionDetection={boardCollisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveName(""); setActiveKind(""); }}>
      <div ref={focusShellRef} className={`group-focus-shell${focusMode ? " open" : ""}`} role={focusMode ? "dialog" : undefined} aria-modal={focusMode ? "true" : undefined} aria-labelledby={focusMode ? "group-focus-title" : undefined} tabIndex={focusMode ? -1 : undefined}>
        <header className="group-workbench-toolbar">
          <div className="group-workbench-title"><strong id="group-focus-title">分组工作台</strong><span>{config.proxies.length} 节点 · {config.proxyGroups.length} 策略组</span></div>
          <div className="group-workbench-actions">
            <button className="icon-button" aria-label="分组操作说明" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}><CircleHelp size={17} /></button>
            <button className="secondary-button group-fullscreen-button" onClick={() => setFocusMode(!focusMode)} aria-label={focusMode ? "退出全屏" : "全屏编辑代理分组"}>{focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}<span>{focusMode ? "退出全屏" : "全屏编辑"}</span></button>
            <button className="primary-button" data-guide-id={guideTargets.groupCreate} onClick={() => setEditing(blankGroup())}><Plus size={16} />添加策略组</button>
            {nextAction}
          </div>
        </header>
        {showHelp && <div className="group-workbench-help" role="note">从总览的组顺序手柄调整排序，从嵌套手柄拖入目标组。节点可拖到当前组成员区；链式组仅接受具体节点。</div>}
      <div className="group-workbench-controls">
        <nav className="group-mobile-tabs" aria-label="分组工作台区域"><button className={mobilePanel === "overview" ? "active" : ""} onClick={() => setMobilePanel("overview")} aria-pressed={mobilePanel === "overview"}><Group size={15} />全部分组</button><button className={mobilePanel === "canvas" ? "active" : ""} onClick={() => setMobilePanel("canvas")} aria-pressed={mobilePanel === "canvas"}><GitBranch size={15} />当前组</button><button className={mobilePanel === "pool" ? "active" : ""} onClick={() => setMobilePanel("pool")} aria-pressed={mobilePanel === "pool"}><Network size={15} />添加内容</button></nav>
      </div>
      <div className={`group-board${activeName ? " is-dragging" : ""}${focusMode ? " focus-mode" : ""} mobile-panel-${mobilePanel}`} data-guide-id={guideTargets.groupBoard}>
        <aside className="group-overview" aria-label="全部策略组">
          <header><div><Group size={18} /><strong>全部分组</strong></div><span>{config.proxyGroups.length}</span></header>
          <SortableContext items={config.proxyGroups.map((group) => groupId(group.id))} strategy={verticalListSortingStrategy}>
            <div className="group-overview-list">{config.proxyGroups.map((group) => <GroupOverviewItem key={group.id} group={group} selected={group.id === selectedGroup?.id} onSelect={() => { setSelectedGroupId(group.id); setMobilePanel("canvas"); }} />)}</div>
          </SortableContext>
        </aside>
        <aside className="node-pool" data-guide-id={guideTargets.groupNodePool} aria-label="当前配置节点">
          <header><div><Network size={18} /><strong>可编排节点</strong></div><span>{nodes.length}</span></header>
          <label className="board-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索节点" aria-label="搜索节点池" /></label>
          {!!config.proxyGroups.length && <div className="pool-target"><span>添加到 <strong>{selectedGroup?.name || ""}</strong></span><button className="secondary-button compact-button" disabled={!selectedNodes.size || !selectedGroup} onClick={() => { if (!selectedGroup) return; addMembers(selectedGroup.id, [...selectedNodes]); setSelectedNodes(new Set()); }}><Plus size={15} />加入所选 {selectedNodes.size || ""}</button></div>}
          <div className="node-pool-list">{nodes.map((node) => <PoolNode key={node.id} node={node} selected={selectedNodes.has(node.name)} targetName={selectedGroup?.name} onToggle={() => toggleNode(node.name)} onAdd={() => selectedGroup && addMembers(selectedGroup.id, [node.name])} />)}{!nodes.length && <div className="pool-empty">{config.proxies.length ? "没有匹配节点" : "先从订阅或节点页导入节点"}</div>}</div>
        </aside>

        <section className="group-canvas" aria-label="当前策略组成员">
          {selectedGroup ? <GroupColumn key={selectedGroup.id} group={selectedGroup} config={config} onEdit={() => setEditing(structuredClone(selectedGroup))} onDelete={() => setDeleting(selectedGroup)} onRemove={(name) => removeMember(selectedGroup.id, name)} onMoveMember={(name, direction) => moveMemberBy(selectedGroup.id, name, direction)} onAddBuiltin={(name) => addMembers(selectedGroup.id, [name])} /> : <button className="empty-group-column" onClick={() => setEditing(blankGroup())}><Plus size={22} /><strong>创建第一个策略组</strong></button>}
        </section>

        <aside className="group-inspector" aria-label="策略组属性">
          {selectedGroup ? <>
            <header><span className="group-icon"><Group size={18} /></span><div><small>正在编辑</small><strong title={selectedGroup.name}>{selectedGroup.name}</strong></div><button className="icon-button compact" onClick={() => setEditing(structuredClone(selectedGroup))} aria-label="编辑当前策略组"><Pencil size={15} /></button></header>
            <div className="inspector-stats"><span>类型<strong>{groupTypes.find((item) => item.value === selectedGroup.type)?.label}</strong></span><span>成员<strong>{selectedGroup.proxies.length}</strong></span><span>嵌套组<strong>{selectedGroup.proxies.filter((name) => config.proxyGroups.some((group) => group.name === name)).length}</strong></span></div>
            <p className="group-context">{selectedGroup.type === "relay" ? "链式代理按成员顺序从入口到出口连接，仅接受具体节点。" : `被 ${config.proxyGroups.filter((group) => group.proxies.includes(selectedGroup.name)).length} 个组引用 · ${config.rules.filter((rule) => rule.target === selectedGroup.name).length} 条规则使用`}</p>
            <section><div className="inspector-title"><GitBranch size={15} /><strong>嵌套其他组</strong></div><p>点击加入当前组，已加入或会形成循环的组不可选。</p><div className="nest-group-list">{config.proxyGroups.filter((group) => group.id !== selectedGroup.id).map((group) => { const included = selectedGroup.proxies.includes(group.name); const allowed = canAddGroupMember(config.proxyGroups, selectedGroup.id, group.name, nodeNames); return <button key={group.id} disabled={included || !allowed} onClick={() => addMembers(selectedGroup.id, [group.name])}><span><Group size={14} />{group.name}</span>{included ? <Check size={14} /> : <Plus size={14} />}</button>; })}{config.proxyGroups.length < 2 && <small>创建第二个策略组后，可在这里建立嵌套策略。</small>}</div></section>
            <section><div className="inspector-title"><GripVertical size={15} /><strong>调整组顺序</strong></div><div className="inspector-actions"><button className="secondary-button compact-button" disabled={config.proxyGroups[0]?.id === selectedGroup.id} onClick={() => moveGroup(selectedGroup.id, -1)}><ArrowUp size={14} />上移</button><button className="secondary-button compact-button" disabled={config.proxyGroups.at(-1)?.id === selectedGroup.id} onClick={() => moveGroup(selectedGroup.id, 1)}><ArrowDown size={14} />下移</button></div></section>
          </> : <div className="inspector-empty"><Group size={21} /><span>选择一个策略组查看属性</span></div>}
        </aside>
      </div>
      </div>
      {createPortal(<DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>{activeName ? <div className={`drag-overlay ${activeKind.startsWith("group-") ? "group-drag-overlay" : "node-drag-overlay"}`}><GripVertical size={16} /><strong>{activeName}</strong><small>{activeKind === "group-reorder" ? "调整分组顺序" : activeKind === "group-nest" ? "嵌套到目标策略组" : "拖入目标组"}</small></div> : null}</DragOverlay>, document.body)}
    </DndContext>
    <GroupEditor key={editing?.id || "closed"} config={config} group={editing} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除策略组" message={`确定删除“${deleting?.name}”吗？其他策略组和规则中的相关引用会自动清理。`} onClose={() => setDeleting(null)} onConfirm={() => {
      if (deleting) {
        onChange({
          ...config,
          proxyGroups: config.proxyGroups.filter((item) => item.id !== deleting.id).map((item) => ({ ...item, proxies: item.proxies.filter((member) => member !== deleting.name) })),
          rules: config.rules.map((rule) => rule.target === deleting.name ? { ...rule, target: "DIRECT" } : rule),
        });
      }
      setDeleting(null);
    }} />
  </>;
}

function PoolNode({ node, selected, targetName, onToggle, onAdd }: { node: ProxyNode; selected: boolean; targetName?: string; onToggle: () => void; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `pool:${node.id}`, data: { kind: "pool", name: node.name } satisfies GroupDragData });
  return <article ref={setNodeRef} className={isDragging ? "pool-node dragging" : "pool-node"} style={{ transform: CSS.Translate.toString(transform) }}><button ref={setActivatorNodeRef} className="drag-handle" {...listeners} {...attributes} aria-label={`拖动节点 ${node.name}`}><GripVertical size={17} /></button><label className="pool-check"><input type="checkbox" checked={selected} onChange={onToggle} /><span className="sr-only">选择 {node.name}</span></label><div className="pool-node-main"><strong title={node.name}>{node.name}</strong><span>{node.type.toUpperCase()} · {node.server || "未设置地址"}</span></div><button className="icon-button compact add-to-group" disabled={!targetName} onClick={onAdd} title={targetName ? `加入 ${targetName}` : "请先创建策略组"} aria-label={targetName ? `将 ${node.name} 加入 ${targetName}` : "请先创建策略组"}><Plus size={16} /></button></article>;
}

function GroupOverviewItem({ group, selected, onSelect }: { group: ProxyGroup; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: groupId(group.id), data: { kind: "group-reorder", groupId: group.id, name: group.name } satisfies GroupDragData });
  const { isOver, setNodeRef: setTargetNodeRef } = useDroppable({ id: overviewTargetId(group.id), data: { kind: "group-target", groupId: group.id } satisfies GroupDropData });
  return <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`group-overview-item${selected ? " selected" : ""}${isDragging ? " dragging" : ""}${isOver ? " nesting-over" : ""}`}>
    <div ref={setTargetNodeRef} className={`group-overview-drop-target${isOver ? " active" : ""}`} aria-hidden="true" />
    <button ref={setActivatorNodeRef} className="drag-handle group-reorder-handle" {...attributes} {...listeners} aria-label={`调整策略组顺序 ${group.name}`} title="拖动调整分组顺序"><GripVertical size={16} /><small>排序</small></button>
    <button className="group-overview-select" onClick={onSelect} aria-pressed={selected} aria-label={`选择策略组 ${group.name}`} title={group.name}><span><strong>{group.name}</strong><small>{groupTypes.find((item) => item.value === group.type)?.label || group.type}</small></span><b aria-label={`${group.proxies.length} 个成员`}>{group.proxies.length}</b></button>
    <GroupNestHandle group={group} />
  </article>;
}

function GroupNestHandle({ group }: { group: ProxyGroup }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: `group-nest:${group.id}`, data: { kind: "group-nest", groupId: group.id, name: group.name } satisfies GroupDragData });
  return <button ref={(element) => { setNodeRef(element); setActivatorNodeRef(element); }} className={`drag-handle group-nest-handle${isDragging ? " dragging" : ""}`} {...listeners} {...attributes} aria-label={`嵌套策略组 ${group.name}`} title="拖动以嵌套到其他组"><GitBranch size={15} /><small>嵌套</small></button>;
}

function GroupColumn({ group, config, onEdit, onDelete, onRemove, onMoveMember, onAddBuiltin }: { group: ProxyGroup; config: MihomoConfig; onEdit: () => void; onDelete: () => void; onRemove: (name: string) => void; onMoveMember: (name: string, direction: -1 | 1) => void; onAddBuiltin: (name: string) => void }) {
  const { isOver: isTargetOver, setNodeRef: setTargetNodeRef } = useDroppable({ id: groupTargetId(group.id), data: { kind: "group-target", groupId: group.id } satisfies GroupDropData });
  return <article className={`group-column${isTargetOver ? " nesting-over" : ""}`}>
    <header className="group-column-header"><span className="group-icon"><Group size={19} /></span><div><h2>{group.name}</h2><span>{groupTypes.find((item) => item.value === group.type)?.label || group.type}</span></div><b>{group.proxies.length}</b><button className="icon-button compact" onClick={onEdit} aria-label={`编辑 ${group.name}`}><Pencil size={15} /></button><button className="icon-button compact danger" onClick={onDelete} aria-label={`删除 ${group.name}`}><Trash2 size={15} /></button></header>
    <SortableContext items={group.proxies.map((name) => memberId(group.id, name))} strategy={verticalListSortingStrategy}><div ref={setTargetNodeRef} className={`group-member-list${isTargetOver ? " nesting-target-active" : ""}`}>{group.proxies.map((name, index) => <SortableMember key={name} name={name} groupId={group.id} node={config.proxies.find((item) => item.name === name)} nestedGroup={config.proxyGroups.find((item) => item.name === name)} canMoveUp={index > 0} canMoveDown={index < group.proxies.length - 1} onMove={(direction) => onMoveMember(name, direction)} onRemove={() => onRemove(name)} />)}{!group.proxies.length ? <div className={`group-drop-empty${isTargetOver ? " active" : ""}`}><Network size={18} /><span><strong>拖动节点或策略组到这里</strong><small>普通组可嵌套策略组；链式组仅放具体节点</small></span></div> : <div className={`group-nest-drop${isTargetOver ? " active" : ""}`}><Group size={15} /><span>将节点添加至此组；使用总览中的嵌套手柄可添加策略组</span></div>}</div></SortableContext>
    <footer className="group-quick-add"><span>快速加入</span>{["DIRECT", "REJECT"].map((name) => <button key={name} disabled={group.type === "relay" || group.proxies.includes(name)} onClick={() => onAddBuiltin(name)}>{group.proxies.includes(name) ? <Check size={13} /> : <Plus size={13} />}{ruleTargetLabel(name, false)}</button>)}</footer>
  </article>;
}

function SortableMember({ name, groupId: ownerId, node, nestedGroup, canMoveUp, canMoveDown, onMove, onRemove }: { name: string; groupId: string; node?: ProxyNode; nestedGroup?: ProxyGroup; canMoveUp: boolean; canMoveDown: boolean; onMove: (direction: -1 | 1) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: memberId(ownerId, name), data: { kind: "member", name, groupId: ownerId } satisfies GroupDragData });
  return <div ref={setNodeRef} className={isDragging ? "group-member dragging" : "group-member"} style={{ transform: CSS.Transform.toString(transform), transition }}><button ref={setActivatorNodeRef} className="drag-handle" {...listeners} {...attributes} aria-label={`拖动成员 ${name}`}><GripVertical size={16} /></button><span className={`member-kind ${node ? "node" : nestedGroup ? "group" : "builtin"}`}>{node ? node.type.slice(0, 2).toUpperCase() : nestedGroup ? <Group size={13} /> : name.slice(0, 1)}</span><div><strong title={name}>{name}</strong><span>{node ? node.server : nestedGroup ? "策略组" : "内置策略"}</span></div><span className="member-touch-order"><button disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`上移 ${name}`}><ArrowUp size={13} /></button><button disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`下移 ${name}`}><ArrowDown size={13} /></button></span><button className="icon-button compact" onClick={onRemove} aria-label={`从策略组移除 ${name}`}><X size={15} /></button></div>;
}

function GroupEditor({ config, group, onClose, onSave }: { config: MihomoConfig; group: ProxyGroup | null; onClose: () => void; onSave: (group: ProxyGroup) => void }) {
  const [draft, setDraft] = useState<ProxyGroup | null>(group);
  if (!group || !draft) return null;
  const nodeNames = new Set(config.proxies.map((node) => node.name));
  const memberOptions = ["DIRECT", "REJECT", ...config.proxies.map((item) => item.name), ...config.proxyGroups.filter((item) => item.id !== draft.id).map((item) => item.name)];
  const draftGroups = config.proxyGroups.some((item) => item.id === draft.id) ? config.proxyGroups.map((item) => item.id === draft.id ? draft : item) : [...config.proxyGroups, draft];
  const toggleMember = (member: string) => {
    if (draft.proxies.includes(member)) setDraft({ ...draft, proxies: draft.proxies.filter((item) => item !== member) });
    else if (canAddGroupMember(draftGroups, draft.id, member, nodeNames)) setDraft({ ...draft, proxies: [...draft.proxies, member] });
  };
  return <Drawer title={group.name === "新策略组" ? "添加策略组" : `编辑 ${group.name}`} open onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!draft.name.trim()} onClick={() => onSave(draft)}>保存策略组</button></>}>
    <div className="form-grid"><label className="span-2">策略组名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="span-2">类型<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as GroupType })}>{groupTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{draft.type !== "select" && draft.type !== "relay" && <><label className="span-2">测速 URL<input value={draft.url || "https://www.gstatic.com/generate_204"} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label><label>间隔（秒）<input type="number" min={10} value={draft.interval || 300} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} /></label><label>容差（毫秒）<input type="number" min={0} value={draft.tolerance || 50} onChange={(event) => setDraft({ ...draft, tolerance: Number(event.target.value) })} /></label></>}</div>
    <fieldset className="member-selector"><legend>成员</legend><div className="member-options">{memberOptions.map((member) => { const checked = draft.proxies.includes(member); const allowed = checked || canAddGroupMember(draftGroups, draft.id, member, nodeNames); return <label key={member} className={!allowed ? "disabled" : ""}><input type="checkbox" checked={checked} disabled={!allowed} onChange={() => toggleMember(member)} /><span>{ruleTargetLabel(member)}</span></label>; })}</div></fieldset>
  </Drawer>;
}
