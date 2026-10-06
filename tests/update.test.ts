import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../server/update";

test("版本比较支持 v 前缀和补零版本", () => {
  assert.equal(compareVersions("v1.1.0", "1.0.9") > 0, true);
  assert.equal(compareVersions("1.1.0", "v1.1.0") , 0);
  assert.equal(compareVersions("1.0.9", "1.1.0") < 0, true);
});
