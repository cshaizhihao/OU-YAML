import assert from "node:assert/strict";
import { test } from "node:test";
import { addGroupMembers, moveGroupMember, reorderGroupMember } from "../src/shared/grouping";
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
  assert.deepEqual(output[0].proxies, ["日本 01", "DIRECT", "香港 01"]);
});

test("成员跨组移动时从原组移除并加入目标组", () => {
  const output = moveGroupMember(groups(), "a", "b", "日本 01", "美国 01");
  assert.deepEqual(output[0].proxies, ["香港 01", "DIRECT"]);
  assert.deepEqual(output[1].proxies, ["日本 01", "美国 01"]);
});
