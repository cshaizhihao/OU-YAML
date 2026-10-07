import assert from "node:assert/strict";
import { test } from "node:test";
import { latencyLevel } from "../src/shared/diagnostics";

test("TCP 延迟严格按 1-50 / 51-160 / 161-9999 分级", () => {
  for (const value of [1, 50]) assert.equal(latencyLevel(value), "good");
  for (const value of [51, 160]) assert.equal(latencyLevel(value), "warn");
  for (const value of [161, 9999]) assert.equal(latencyLevel(value), "bad");
  for (const value of [0, -1, 10000, NaN, Infinity, null, undefined]) assert.equal(latencyLevel(value), "unknown");
});
