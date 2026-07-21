import type { ProxyGroup } from "./types";

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
    const proxies = [...group.proxies]; const [member] = proxies.splice(from, 1); proxies.splice(to, 0, member);
    return { ...group, proxies };
  });
}

export function moveGroupMember(groups: ProxyGroup[], sourceGroupId: string, targetGroupId: string, name: string, before?: string) {
  const removed = removeGroupMember(groups, sourceGroupId, name);
  return addGroupMembers(removed, targetGroupId, [name], before);
}
