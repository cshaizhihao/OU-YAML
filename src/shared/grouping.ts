import type { ProxyGroup } from "./types";

function groupByName(groups: ProxyGroup[], name: string) {
  return groups.find((group) => group.name === name);
}

type NodeNames = ReadonlySet<string>;

export type GroupDragData =
  | { kind: "pool"; name: string }
  | { kind: "member"; name: string; groupId: string }
  | { kind: "group-nest" | "group-reorder"; name: string; groupId: string };
export type GroupDropData = GroupDragData | { kind: "group-target"; groupId: string };

export function canDropGroupItem(groups: ProxyGroup[], active: GroupDragData, over: GroupDropData, nodeNames: NodeNames) {
  if (active.kind === "group-reorder") return over.kind === "group-reorder" && active.groupId !== over.groupId;
  if (over.kind !== "member" && over.kind !== "group-target") return false;
  if (active.kind === "member" && active.groupId === over.groupId) return over.kind !== "member" || active.name !== over.name;
  const target = groups.find((group) => group.id === over.groupId);
  const next = active.kind === "member" ? removeGroupMember(groups, active.groupId, active.name) : groups;
  return !!target && !target.proxies.includes(active.name) && canAddGroupMember(next, target.id, active.name, nodeNames);
}

function reachesGroup(groups: ProxyGroup[], startName: string, targetName: string, visited = new Set<string>()): boolean {
  if (startName === targetName) return true;
  if (visited.has(startName)) return false;
  visited.add(startName);
  const group = groupByName(groups, startName);
  return !!group?.proxies.some((member) => groupByName(groups, member) && reachesGroup(groups, member, targetName, visited));
}

export function canAddGroupMember(groups: ProxyGroup[], targetGroupId: string, memberName: string, nodeNames?: NodeNames) {
  const target = groups.find((group) => group.id === targetGroupId);
  const memberGroup = groupByName(groups, memberName);
  if (!target) return false;
  if (target.type === "relay" && (memberGroup || !nodeNames?.has(memberName))) return false;
  if (!memberGroup) return true;
  if (target.id === memberGroup.id) return false;
  return !reachesGroup(groups, memberGroup.name, target.name);
}

export function hasGroupCycle(groups: ProxyGroup[]) {
  return groups.some((group) => group.proxies.some((member) => groupByName(groups, member) && reachesGroup(groups, member, group.name)));
}

export function addGroupMembers(groups: ProxyGroup[], targetGroupId: string, names: string[], before?: string, nodeNames?: NodeNames) {
  return groups.map((group) => {
    if (group.id !== targetGroupId) return group;
    const additions = [...new Set(names)].filter((name) => !group.proxies.includes(name) && canAddGroupMember(groups, targetGroupId, name, nodeNames));
    if (!additions.length) return group;
    const index = before ? group.proxies.indexOf(before) : -1;
    const proxies = index >= 0 ? [...group.proxies.slice(0, index), ...additions, ...group.proxies.slice(index)] : [...group.proxies, ...additions];
    return { ...group, proxies };
  });
}

export function removeGroupMember(groups: ProxyGroup[], targetGroupId: string, name: string) {
  return groups.map((group) => group.id === targetGroupId ? { ...group, proxies: group.proxies.filter((member) => member !== name) } : group);
}

export function reorderGroupMember(groups: ProxyGroup[], targetGroupId: string, name: string, before: string, placement: "before" | "after" = "before") {
  return groups.map((group) => {
    if (group.id !== targetGroupId || name === before) return group;
    const from = group.proxies.indexOf(name); const target = before ? group.proxies.indexOf(before) : group.proxies.length;
    if (from < 0 || target < 0) return group;
    const to = target + (before && placement === "after" ? 1 : 0);
    const proxies = [...group.proxies]; const [member] = proxies.splice(from, 1); proxies.splice(from < to ? to - 1 : to, 0, member);
    return { ...group, proxies };
  });
}

export function moveGroupMember(groups: ProxyGroup[], sourceGroupId: string, targetGroupId: string, name: string, before?: string, nodeNames?: NodeNames) {
  if (!groups.find((group) => group.id === sourceGroupId)?.proxies.includes(name)) return groups;
  if (sourceGroupId === targetGroupId) return reorderGroupMember(groups, sourceGroupId, name, before || "");
  const removed = removeGroupMember(groups, sourceGroupId, name);
  if (!canAddGroupMember(removed, targetGroupId, name, nodeNames)) return groups;
  return addGroupMembers(removed, targetGroupId, [name], before, nodeNames);
}

export function reorderGroups(groups: ProxyGroup[], groupId: string, beforeGroupId: string, placement: "before" | "after" = "before") {
  if (groupId === beforeGroupId) return groups;
  const from = groups.findIndex((group) => group.id === groupId);
  const to = groups.findIndex((group) => group.id === beforeGroupId);
  if (from < 0 || to < 0) return groups;
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  const destination = to + (placement === "after" ? 1 : 0);
  next.splice(from < destination ? destination - 1 : destination, 0, moved);
  return next;
}
