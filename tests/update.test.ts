import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, compareVersions } from "../server/update";

test("版本比较支持 v 前缀和补零版本", () => {
  assert.equal(compareVersions("v1.1.0", "1.0.9") > 0, true);
  assert.equal(compareVersions("1.1.0", "v1.1.0") , 0);
  assert.equal(compareVersions("1.0.9", "1.1.0") < 0, true);
});

test("没有 GitHub Release 时从 main 分支清单检查版本", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/releases/latest")) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await checkForUpdate();
    assert.equal(result.latestVersion, "99.0.0");
    assert.equal(result.hasUpdate, true);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
