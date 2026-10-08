import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { api as clientApi, ApiError } from "../src/api";
import type { MihomoConfig } from "../src/shared/types";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ou-yaml-api-test-"));
const password = "test-password-123";
let server: ChildProcessWithoutNullStreams;
let baseUrl = "";
let cookie = "";

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child: ChildProcessWithoutNullStreams) {
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`API 启动超时：${output}`)), 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("OU-YAML API listening")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`API 提前退出（${code}）：${output}`));
    });
  });
}

async function api(pathname: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Origin: baseUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
}

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: password,
      NODE_ENV: "production",
      APP_ORIGIN: baseUrl,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  await waitForServer(server);
  const response = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  assert.match(cookie, /^ou_session=/);
});

after(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (!server.killed) server.kill("SIGKILL");
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("快捷发布与恢复地址需要登录，并隔离不存在的资源", async () => {
  const anonymous = await fetch(`${baseUrl}/api/projects/unknown/quick-publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(anonymous.status, 401);
  assert.equal((await fetch(`${baseUrl}/api/projects/unknown/quick-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await api("/api/projects/unknown/quick-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/generated-subscriptions/unknown/token`)).status, 401);
  const missing = await api("/api/generated-subscriptions/unknown/token");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${baseUrl}/api/generated-subscriptions/unknown/editor`)).status, 401);
  assert.equal((await api("/api/generated-subscriptions/unknown/editor")).status, 404);
  assert.equal((await api("/api/generated-subscriptions/unknown/name", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "" }) })).status, 400);
  const source = await api("/api/node-sources/unknown/diagnose", { method: "POST" });
  assert.equal(source.status, 404);
  const proxy = await api("/api/managed-nodes/unknown/proxy-test", { method: "POST" });
  assert.equal(proxy.status, 404);
});

test("未知 API 在生产 SPA 回退前返回 JSON 404", async () => {
  const response = await api("/api/route-that-does-not-exist", { headers: { Accept: "text/html" } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") || "", /^application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json() as { error: string }).error, /API 接口不存在/);
});

test("订阅编辑 API 可以载入、保存并重新载入真实订阅", async () => {
  const projectResponse = await api("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "编辑器 API 回归" }) });
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json() as { id: string; updatedAt: string };
  const nodeResponse = await api("/api/managed-nodes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "编辑器 API 节点", type: "vless", server: "example.com", port: 443, uuid: "editor-api-test", enabled: true, tags: [], extra: {} }),
  });
  assert.equal(nodeResponse.status, 201);
  const node = await nodeResponse.json() as { id: string };
  const input = { nodeIds: [node.id], preset: "simple", autoUpdate: false, includeNewNodes: false, updatedAt: project.updatedAt, name: "编辑器 API 订阅" };
  const previewResponse = await api(`/api/projects/${project.id}/quick-preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as { revision: string };
  const publishResponse = await api(`/api/projects/${project.id}/quick-publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, previewRevision: preview.revision }) });
  const publishBody = await publishResponse.text();
  assert.equal(publishResponse.status, 200, publishBody);
  const published = JSON.parse(publishBody) as { id: string };

  const editorResponse = await api(`/api/generated-subscriptions/${published.id}/editor`);
  assert.equal(editorResponse.status, 200);
  const editor = await editorResponse.json() as { subscription: { name: string; version: number }; config: MihomoConfig; revision: string };
  const groupName = "编辑器 API 保存后重载";
  const oldGroupName = editor.config.proxyGroups[0].name;
  const config = {
    ...editor.config,
    proxyGroups: editor.config.proxyGroups.map((group, index) => index === 0 ? { ...group, name: groupName } : group),
    rules: editor.config.rules.map((rule) => rule.target === oldGroupName ? { ...rule, target: groupName } : rule),
  };
  const saveResponse = await api(`/api/generated-subscriptions/${published.id}/editor`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "已保存的编辑器订阅", config, revision: editor.revision }),
  });
  const saveBody = await saveResponse.text();
  assert.equal(saveResponse.status, 200, saveBody);
  const saved = JSON.parse(saveBody) as { subscription: { name: string; version: number }; config: MihomoConfig; revision: string };
  assert.equal(saved.subscription.name, "已保存的编辑器订阅");
  assert.equal(saved.config.proxyGroups[0].name, groupName);

  const reloadResponse = await api(`/api/generated-subscriptions/${published.id}/editor`);
  assert.equal(reloadResponse.status, 200);
  const reloaded = await reloadResponse.json() as typeof saved;
  assert.equal(reloaded.subscription.name, saved.subscription.name);
  assert.equal(reloaded.subscription.version, saved.subscription.version);
  assert.equal(reloaded.config.proxyGroups[0].name, groupName);
  assert.equal(reloaded.revision, saved.revision);
});

test("API 客户端区分网络、HTTP、非 JSON 和无效 JSON，并保留 204 与 YAML 导出", async () => {
  const originalFetch = globalThis.fetch;
  let responseFactory: () => Response | Promise<Response> = () => new Response("{}", { headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async () => responseFactory()) as typeof fetch;
  try {
    responseFactory = () => new Response("not json", { headers: { "Content-Type": "text/html" } });
    await assert.rejects(clientApi.me(), (error: unknown) => error instanceof ApiError && error.kind === "invalid-response");
    responseFactory = () => new Response("{", { headers: { "Content-Type": "application/json" } });
    await assert.rejects(clientApi.me(), (error: unknown) => error instanceof ApiError && error.kind === "invalid-response");
    responseFactory = () => new Response(JSON.stringify({ error: "服务端拒绝请求" }), { status: 503, headers: { "Content-Type": "application/json" } });
    await assert.rejects(clientApi.me(), (error: unknown) => error instanceof ApiError && error.kind === "http" && error.status === 503 && error.message === "服务端拒绝请求");
    responseFactory = () => { throw new Error("offline"); };
    await assert.rejects(clientApi.me(), (error: unknown) => error instanceof ApiError && error.kind === "network");
    responseFactory = () => new Response(null, { status: 204 });
    assert.equal(await clientApi.logout(), undefined);
    responseFactory = () => new Response("proxies: []\n", { headers: { "Content-Type": "application/yaml; charset=utf-8" } });
    assert.equal(await clientApi.exportConfig({} as MihomoConfig, "mihomo"), "proxies: []\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("浏览器跨站修改请求会被 Origin 防护拒绝", async () => {
  const response = await api("/api/projects", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "不应创建" }),
  });
  assert.equal(response.status, 403);
});

test("保存、导出和内核校验都拒绝非法 Mihomo 配置", async () => {
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "结构校验" }),
  });
  assert.equal(created.status, 201);
  const project = await created.json() as { id: string; updatedAt: string };
  const invalidConfig = { version: 1, proxies: [], proxyGroups: [], rules: [] };
  for (const [pathname, body, expected] of [
    [`/api/projects/${project.id}`, { config: invalidConfig, name: "非法", updatedAt: project.updatedAt }, 400],
    ["/api/tools/export", { config: invalidConfig, format: "mihomo" }, 400],
    ["/api/tools/kernel-validate", { config: invalidConfig, format: "mihomo" }, 400],
  ] as const) {
    const response = await api(pathname, { method: pathname.includes(project.id) ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, expected, pathname);
  }
});

test("项目保存使用版本号阻止旧页面覆盖新配置", async () => {
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "并发保护" }),
  });
  const project = await created.json() as { id: string; name: string; updatedAt: string; config: unknown; targetFormat: string };
  const first = await api(`/api/projects/${project.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...project, name: "新版本" }),
  });
  assert.equal(first.status, 200);
  const stale = await api(`/api/projects/${project.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...project, name: "旧版本覆盖" }),
  });
  assert.equal(stale.status, 409);
});

test("文件节点来源可以上传并解析分享链接", async () => {
  const created = await api("/api/node-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "上传文件", kind: "file", format: "links", enabled: true }),
  });
  assert.equal(created.status, 201);
  const source = await created.json() as { id: string };
  const imported = await api(`/api/node-sources/${source.id}/import`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "vless://test-uuid@edge.example.com:443?security=tls#上传节点",
  });
  assert.equal(imported.status, 200);
  const result = await imported.json() as { nodes: { name: string; type: string }[] };
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].name, "上传节点");
  assert.equal(result.nodes[0].type, "vless");
});

test("节点 API 支持批量启停、标签和改名", async () => {
  const ids: string[] = [];
  for (const name of ["HK-旧节点", "JP-旧节点"]) {
    const response = await api("/api/managed-nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: "vless", server: `${name.slice(0, 2).toLowerCase()}.example.com`, port: 443, uuid: `uuid-${name}`, extra: {} }),
    });
    assert.equal(response.status, 201);
    ids.push((await response.json() as { id: string }).id);
  }
  const response = await api("/api/managed-nodes/batch", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, enabled: false, addTags: ["测试"], prefix: "优选-", find: "旧节点", replace: "线路" }),
  });
  assert.equal(response.status, 200);
  const nodes = await response.json() as { id: string; name: string; enabled: boolean; tags: string[] }[];
  const selected = nodes.filter((node) => ids.includes(node.id));
  assert.equal(selected.every((node) => !node.enabled && node.tags.includes("测试") && node.name.startsWith("优选-") && node.name.endsWith("线路")), true);
});

test("节点 TCP 检测阻止探测本机和局域网", async () => {
  const created = await api("/api/managed-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "本机端口", type: "socks5", server: "127.0.0.1", port: 22, extra: {} }),
  });
  assert.equal(created.status, 201);
  const node = await created.json() as { id: string };
  const response = await api(`/api/managed-nodes/${node.id}/tcp-ping`, { method: "POST" });
  assert.equal(response.status, 422);
  assert.match((await response.json() as { error: string }).error, /本机或局域网/);
});

test("入口 IP 归属地查询失败时不改节点名称或更新时间", async () => {
  const created = await api("/api/managed-nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "归属地失败节点", type: "vless", server: "127.0.0.1", port: 443, uuid: "country-failure", extra: {} }),
  });
  assert.equal(created.status, 201);
  const node = await created.json() as { id: string; name: string; updatedAt: string };
  const response = await api(`/api/managed-nodes/${node.id}/country-flag`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basis: "entry" }) });
  assert.equal(response.status, 422);
  const nodes = await (await api("/api/managed-nodes")).json() as { id: string; name: string; updatedAt: string }[];
  assert.deepEqual(nodes.find((item) => item.id === node.id), node);
});
