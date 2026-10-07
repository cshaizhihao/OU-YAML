import assert from "node:assert/strict";
import { test } from "node:test";
import { addGroupMembers, canAddGroupMember, hasGroupCycle, moveGroupMember, reorderGroupMember, reorderGroups } from "../src/shared/grouping";
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
