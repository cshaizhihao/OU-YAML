import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

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
      NODE_ENV: "test",
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
