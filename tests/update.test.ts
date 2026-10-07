import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkForUpdate, compareVersions } from "../server/update";

const currentVersion = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("稳定渠道只检查 Release 标签，不跟随 main", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(url.endsWith("/releases/latest") ? { tag_name: "v99.0.0", body: "stable notes" } : { sha: "c".repeat(40) }));
  }) as typeof fetch;
  try {
    const result = await checkForUpdate();
    assert.equal(result.channel, "stable");
    assert.equal(result.latestVersion, "99.0.0");
    assert.equal(result.hasUpdate, true);
    assert.equal(result.releaseNotes, "stable notes");
    assert.ok(calls[1].endsWith("/commits/v99.0.0"));
    assert.equal(calls.length, 2);
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    await assert.rejects(checkForUpdate(), /没有可用稳定版本/);
  } finally { globalThis.fetch = originalFetch; }
});

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
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: "b".repeat(40), commit: { message: "new build" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await checkForUpdate("preview");
    assert.equal(result.latestVersion, "99.0.0");
    assert.equal(result.hasUpdate, true);
    assert.equal(result.updateKind, "version");
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("版本号相同时通过 main 提交发现新构建", async () => {
  const originalFetch = globalThis.fetch;
  const originalCommit = process.env.APP_COMMIT;
  process.env.APP_COMMIT = "a".repeat(40);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/releases/latest")) return new Response(JSON.stringify({ tag_name: `v${currentVersion}`, body: "release" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: "b".repeat(40), commit: { message: "new build" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ version: currentVersion }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await checkForUpdate("preview");
    assert.equal(result.currentVersion, currentVersion);
    assert.equal(result.latestVersion, currentVersion);
    assert.equal(result.hasUpdate, true);
    assert.equal(result.updateKind, "build");
    assert.equal(result.currentCommit, "a".repeat(40));
    assert.equal(result.latestCommit, "b".repeat(40));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCommit === undefined) delete process.env.APP_COMMIT;
    else process.env.APP_COMMIT = originalCommit;
  }
});

test("本地版本高于 main 时不提示降级", async () => {
  const originalFetch = globalThis.fetch;
  const originalCommit = process.env.APP_COMMIT;
  process.env.APP_COMMIT = "a".repeat(40);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/releases/latest")) return new Response("not found", { status: 404 });
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: "b".repeat(40) }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ version: "1.2.9" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await checkForUpdate("preview");
    assert.equal(result.hasUpdate, false);
    assert.equal(result.updateKind, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCommit === undefined) delete process.env.APP_COMMIT;
    else process.env.APP_COMMIT = originalCommit;
  }
});

test("Release 落后于 main 时展示 main 构建信息", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/releases/latest")) return new Response(JSON.stringify({ tag_name: "v1.3.0", html_url: "https://example.com/old", body: "old notes" }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/commits/main")) return new Response(JSON.stringify({ sha: "b".repeat(40), html_url: "https://example.com/new", commit: { message: "new build", committer: { date: "2026-10-07T00:00:00Z" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await checkForUpdate("preview");
    assert.equal(result.latestVersion, "99.0.0");
    assert.equal(result.releaseUrl, "https://example.com/new");
    assert.match(result.releaseNotes, /new build/);
    assert.equal(result.publishedAt, "2026-10-07T00:00:00Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
