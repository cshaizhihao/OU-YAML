import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill("ou-yaml-e2e-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始三步教程" })).toBeVisible();
  await page.getByRole("button", { name: "暂时跳过" }).click();
}

test("工作台固定，滚动责任留在内容面板", async ({ page }) => {
  await login(page);
  for (const route of ["/app/home", "/app/workspace/rules", "/app/system/settings"]) {
    await page.goto(route);
    await expect(page.locator(".main-shell")).toBeVisible();
    const metrics = await page.evaluate(() => ({
      viewport: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      contentHeight: document.querySelector<HTMLElement>(".content-area")?.scrollHeight || 0,
      contentViewport: document.querySelector<HTMLElement>(".content-area")?.clientHeight || 0,
    }));
    expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.bodyHeight).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.contentHeight).toBeGreaterThanOrEqual(metrics.contentViewport);
  }
});

test("策略组可以直接拖入另一个策略组", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "移动端使用当前组切换和属性面板完成组嵌套");
  await login(page);
  const created = await page.request.post("/api/projects", { data: { name: "组嵌套验收" } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const firstNode = {
    id: "layout-node-1",
    name: "测试节点",
    type: "http",
    server: "127.0.0.1",
    port: 8080,
    extra: {},
  };
  const config = {
    ...project.config,
    proxies: [firstNode],
    proxyGroups: [
      { id: "layout-group-a", name: "A策略组", type: "select", proxies: ["测试节点"], extra: {} },
      { id: "layout-group-b", name: "B策略组", type: "select", proxies: ["DIRECT"], extra: {} },
    ],
    rules: [{ id: "layout-rule", type: "MATCH", value: "", target: "A策略组", options: [], enabled: true }],
  };
  const saved = await page.request.put(`/api/projects/${project.id}`, { data: { ...project, config } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/app/workspace/groups`);
  await page.getByRole("combobox", { name: "当前配置" }).selectOption(project.id);
  await expect(page.getByRole("heading", { name: "A策略组", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全屏编辑代理分组", exact: true }).click();
  await expect(page.locator(".group-focus-shell.open")).toBeVisible();
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  const source = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "A策略组", exact: true }) });
  const target = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "B策略组", exact: true }) });
  const handle = source.getByRole("button", { name: "拖动策略组 A策略组", exact: true });
  const dropZone = target.locator(".group-member-list");
  const handleBox = await handle.boundingBox();
  const dropBox = await dropZone.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(dropBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropBox!.x + dropBox!.width / 2, dropBox!.y + dropBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(target.locator(".group-member").filter({ hasText: "A策略组" })).toBeVisible();
});

test("TCP 探测结果紧邻按钮并按延迟显示颜色", async ({ page }) => {
  await login(page);
  const sourceResponse = await page.request.post("/api/node-sources", { data: { name: "TCP 行内验收", kind: "file", format: "auto", enabled: true, intervalMinutes: 0 } });
  expect(sourceResponse.ok()).toBeTruthy();
  const source = await sourceResponse.json();
  const imported = await page.request.post(`/api/node-sources/${source.id}/import`, { data: "vless://dba693d3-d530-4235-bf30-cb9c30d89481@1.1.1.1:443?security=tls&sni=example.com#TCP行内节点", headers: { "Content-Type": "text/plain" } });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const node = (await imported.json()).nodes[0];
  await page.goto("/app/nodes");
  await page.getByPlaceholder("搜索名称、地址、协议、标签或备注").fill(node.name);
  const row = page.locator(".node-row").filter({ has: page.getByRole("button", { name: `检测节点 ${node.name}`, exact: true }) });
  await expect(row).toBeVisible();
  let latency = 42;
  await page.route("**/api/managed-nodes/*/tcp-ping", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reachable: true, latencyMs: latency, resolvedAddress: "1.1.1.1" }) }));
  const probe = row.getByRole("button", { name: `检测节点 ${node.name}`, exact: true });
  await probe.click();
  const result = row.locator(".tcp-latency");
  await expect(result).toHaveText("42ms");
  await expect(result).toHaveClass(/good/);
  await expect(probe.locator("xpath=following-sibling::*[1]")).toHaveClass(/tcp-latency/);
  const probeBox = await probe.boundingBox();
  const resultBox = await result.boundingBox();
  expect(probeBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(resultBox!.x).toBeGreaterThanOrEqual(probeBox!.x + probeBox!.width - 1);
  await expect(page.locator(".toast")).toHaveCount(0);
  latency = 80;
  await probe.click();
  await expect(row.locator(".tcp-latency")).toHaveClass(/warn/);
  latency = 200;
  await probe.click();
  await expect(row.locator(".tcp-latency")).toHaveClass(/bad/);
  expect(node.id).toBeTruthy();
});
