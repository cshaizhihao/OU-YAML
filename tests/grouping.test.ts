import assert from "node:assert/strict";
import { test } from "node:test";
import { addGroupMembers, canAddGroupMember, canDropGroupItem, hasGroupCycle, moveGroupMember, reorderGroupMember, reorderGroups } from "../src/shared/grouping";
import type { ProxyGroup } from "../src/shared/types";

const groups = (): ProxyGroup[] => [
  { id: "a", name: "节点选择", type: "select", proxies: ["香港 01", "日本 01", "DIRECT"], extra: {} },
  { id: "b", name: "故障转移", type: "fallback", proxies: ["美国 01"], extra: {} },
];

test("批量加入成员时保持顺序并去重", () => {
  const output = addGroupMembers(groups(), "b", ["德国 01", "美国 01"], "美国 01");
  assert.deepEqual(output[1].proxies, ["德国 01", "美国 01"]);
});

test("策略组内成员可以重新排序", () => {
  const output = reorderGroupMember(groups(), "a", "香港 01", "DIRECT");
  assert.deepEqual(output[0].proxies, ["日本 01", "香港 01", "DIRECT"]);
  const movedDown = reorderGroupMember(groups(), "a", "DIRECT", "香港 01");
  assert.deepEqual(movedDown[0].proxies, ["DIRECT", "香港 01", "日本 01"]);
});

test("成员跨组移动时从原组移除并加入目标组", () => {
  const output = moveGroupMember(groups(), "a", "b", "日本 01", "美国 01");
  assert.deepEqual(output[0].proxies, ["香港 01", "DIRECT"]);
  assert.deepEqual(output[1].proxies, ["日本 01", "美国 01"]);
});

test("策略组可以整体重新排序", () => {
  const groups = [
    { id: "a", name: "A", type: "select", proxies: [], extra: {} },
    { id: "b", name: "B", type: "select", proxies: [], extra: {} },
    { id: "c", name: "C", type: "select", proxies: [], extra: {} },
  ] as any;
  assert.deepEqual(reorderGroups(groups, "c", "a").map((group: any) => group.id), ["c", "a", "b"]);
  assert.deepEqual(reorderGroups(groups, "a", "c").map((group: any) => group.id), ["b", "a", "c"]);
});

test("策略组拖放会阻止自引用和循环引用", () => {
  const nested: ProxyGroup[] = [
    { id: "a", name: "A", type: "select", proxies: ["B"], extra: {} },
    { id: "b", name: "B", type: "select", proxies: [], extra: {} },
  ];
  assert.equal(canAddGroupMember(nested, "b", "A"), false);
  assert.equal(canAddGroupMember(nested, "a", "A"), false);
  assert.equal(canAddGroupMember(nested, "a", "B"), true);
  assert.equal(hasGroupCycle(nested), false);
  assert.equal(hasGroupCycle([{ ...nested[1], proxies: ["A"] }, nested[0]]), true);
});

test("策略组可以嵌套到另一个策略组并保持插入位置", () => {
  const nested: ProxyGroup[] = [
    { id: "a", name: "节点选择", type: "select", proxies: [], extra: {} },
    { id: "b", name: "自动选择", type: "url-test", proxies: ["DIRECT"], extra: {} },
  ];
  assert.equal(canAddGroupMember(nested, "b", "节点选择"), true);
  const output = addGroupMembers(nested, "b", ["节点选择"], "DIRECT");
  assert.deepEqual(output[1].proxies, ["节点选择", "DIRECT"]);
  assert.equal(canAddGroupMember(output, "a", "自动选择"), false);
});

test("链式代理组拒绝策略组和内置目标", () => {
  const relay: ProxyGroup[] = [{ id: "relay", name: "链式", type: "relay", proxies: [], extra: {} }];
  assert.equal(canAddGroupMember(relay, "relay", "DIRECT"), false);
  assert.equal(canAddGroupMember(relay, "relay", "另一个组"), false);
  assert.equal(canAddGroupMember(relay, "relay", "香港 01", new Set(["香港 01"])), true);
  assert.deepEqual(addGroupMembers(relay, "relay", ["DIRECT", "另一个组"])[0].proxies, []);
  assert.deepEqual(addGroupMembers(relay, "relay", ["香港 01"], undefined, new Set(["香港 01"]))[0].proxies, ["香港 01"]);
});

test("分组拖放明确区分嵌套与排序并保留成员类型约束", () => {
  const nested: ProxyGroup[] = [
    { id: "a", name: "节点选择", type: "select", proxies: ["香港 01"], extra: {} },
    { id: "b", name: "自动选择", type: "url-test", proxies: ["DIRECT"], extra: {} },
    { id: "relay", name: "链式", type: "relay", proxies: [], extra: {} },
  ];
  const nodeNames = new Set(["香港 01", "日本 01"]);
  const nest = { kind: "group-nest", groupId: "a", name: "节点选择" } as const;
  const reorder = { kind: "group-reorder", groupId: "a", name: "节点选择" } as const;
  const member = { kind: "member", groupId: "a", name: "香港 01" } as const;
  const target = { kind: "group-target", groupId: "b" } as const;
  assert.equal(canDropGroupItem(nested, nest, target, nodeNames), true);
  assert.equal(canDropGroupItem(nested, nest, { ...target, groupId: "a" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, nest, { ...target, groupId: "relay" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, reorder, target, nodeNames), false);
  assert.equal(canDropGroupItem(nested, reorder, { kind: "group-reorder", groupId: "b", name: "自动选择" }, nodeNames), true);
  assert.equal(canDropGroupItem(nested, { kind: "pool", name: "日本 01" }, target, nodeNames), true);
  assert.equal(canDropGroupItem(nested, member, { ...target, groupId: "relay" }, nodeNames), true);
  assert.deepEqual(moveGroupMember(nested, "a", "relay", "香港 01", undefined, nodeNames).map((group) => group.proxies), [[], ["DIRECT"], ["香港 01"]]);
  assert.deepEqual(reorderGroupMember(nested, "a", "香港 01", "香港 01"), nested);
  assert.deepEqual(reorderGroups(nested, "a", "b", "after").map((group) => group.id), ["b", "a", "relay"]);
});

test("嵌套拖放拒绝重复、间接循环及错误手柄目标，非法移动保留原组", () => {
  const nested: ProxyGroup[] = [
    { id: "a", name: "A", type: "select", proxies: ["B"], extra: {} },
    { id: "b", name: "B", type: "select", proxies: ["C"], extra: {} },
    { id: "c", name: "C", type: "select", proxies: ["DIRECT"], extra: {} },
    { id: "relay", name: "链式", type: "relay", proxies: [], extra: {} },
  ];
  const nodeNames = new Set(["香港 01"]);
  const nest = { kind: "group-nest", groupId: "a", name: "A" } as const;
  assert.equal(canDropGroupItem(nested, nest, { kind: "group-target", groupId: "c" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, nest, { kind: "group-reorder", groupId: "c", name: "C" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, { kind: "group-nest", groupId: "b", name: "B" }, { kind: "group-target", groupId: "a" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, { kind: "pool", name: "DIRECT" }, { kind: "group-target", groupId: "relay" }, nodeNames), false);
  assert.equal(canDropGroupItem(nested, { kind: "member", groupId: "a", name: "B" }, { kind: "group-target", groupId: "c" }, nodeNames), false);
  assert.deepEqual(moveGroupMember(nested, "a", "c", "B", undefined, nodeNames), nested);
  assert.deepEqual(moveGroupMember(nested, "a", "relay", "B", undefined, nodeNames), nested);
  assert.deepEqual(moveGroupMember(nested, "c", "relay", "DIRECT", undefined, nodeNames), nested);
  assert.equal(hasGroupCycle(nested), false);
});
