import type { ProxyGroup } from "./types";

function groupByName(groups: ProxyGroup[], name: string) {
  return groups.find((group) => group.name === name);
}

function reachesGroup(groups: ProxyGroup[], startName: string, targetName: string, visited = new Set<string>()): boolean {
  if (startName === targetName) return true;
  if (visited.has(startName)) return false;
  visited.add(startName);
  const group = groupByName(groups, startName);
  return !!group?.proxies.some((member) => groupByName(groups, member) && reachesGroup(groups, member, targetName, visited));
}

export function canAddGroupMember(groups: ProxyGroup[], targetGroupId: string, memberName: string) {
  const target = groups.find((group) => group.id === targetGroupId);
  const memberGroup = groupByName(groups, memberName);
  if (!target || !memberGroup) return true;
  if (target.id === memberGroup.id) return false;
  return !reachesGroup(groups, memberGroup.name, target.name);
}

export function hasGroupCycle(groups: ProxyGroup[]) {
  return groups.some((group) => group.proxies.some((member) => groupByName(groups, member) && reachesGroup(groups, member, group.name)));
}

export function addGroupMembers(groups: ProxyGroup[], targetGroupId: string, names: string[], before?: string) {
  return groups.map((group) => {
    if (group.id !== targetGroupId) return group;
    const additions = names.filter((name) => !group.proxies.includes(name));
    if (!additions.length) return group;
    const index = before ? group.proxies.indexOf(before) : -1;
    const proxies = index >= 0 ? [...group.proxies.slice(0, index), ...additions, ...group.proxies.slice(index)] : [...group.proxies, ...additions];
    return { ...group, proxies };
  });
}

export function removeGroupMember(groups: ProxyGroup[], targetGroupId: string, name: string) {
  return groups.map((group) => group.id === targetGroupId ? { ...group, proxies: group.proxies.filter((member) => member !== name) } : group);
}

export function reorderGroupMember(groups: ProxyGroup[], targetGroupId: string, name: string, before: string) {
  return groups.map((group) => {
    if (group.id !== targetGroupId || name === before) return group;
    const from = group.proxies.indexOf(name); const to = group.proxies.indexOf(before);
    if (from < 0 || to < 0) return group;
    const proxies = [...group.proxies]; const [member] = proxies.splice(from, 1); proxies.splice(from < to ? to - 1 : to, 0, member);
    return { ...group, proxies };
  });
}

export function moveGroupMember(groups: ProxyGroup[], sourceGroupId: string, targetGroupId: string, name: string, before?: string) {
  const removed = removeGroupMember(groups, sourceGroupId, name);
  return addGroupMembers(removed, targetGroupId, [name], before);
}

export function reorderGroups(groups: ProxyGroup[], groupId: string, beforeGroupId: string) {
  if (groupId === beforeGroupId) return groups;
  const from = groups.findIndex((group) => group.id === groupId);
  const to = groups.findIndex((group) => group.id === beforeGroupId);
  if (from < 0 || to < 0) return groups;
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, moved);
  return next;
}
