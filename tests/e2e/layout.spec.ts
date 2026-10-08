import { test, expect, type Page } from "@playwright/test";
import { parse } from "yaml";

async function login(page: Page) {
  await page.goto("/");
  const loginForm = page.getByLabel("账号", { exact: true });
  if (await loginForm.isVisible().catch(() => false)) {
    await loginForm.fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("ou-yaml-e2e-12345");
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "开始三步教程" })).toBeVisible();
  await page.getByRole("button", { name: "暂时跳过" }).click();
}

test("规则摘要、编辑、排序和删除在四种宽度可用并保存英文配置", async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const created = await page.request.post("/api/projects", { data: { name: `规则回归-${test.info().project.name}` } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const domain = `${"long-domain-".repeat(4)}.${"long-rule-".repeat(4)}.example.com`;
  const config = { ...project.config, rules: [
    { id: "rule-long", type: "DOMAIN-SUFFIX", value: domain, target: "DIRECT", options: [], enabled: true },
    { id: "rule-second", type: "DOMAIN", value: "second.example.com", target: "DIRECT", options: [], enabled: true },
    { id: "rule-match", type: "MATCH", value: "", target: "DIRECT", options: [], enabled: true },
  ] };
  const saved = await page.request.put(`/api/projects/${project.id}`, { data: { ...project, config } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto("/app/workspace/rules");
  await page.getByRole("combobox", { name: "当前配置", exact: true }).selectOption(project.id);
  const cards = page.locator(".beginner-rule-card");
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".rule-inline-editor")).toHaveCount(0);
  const widths = test.info().project.name === "desktop" ? [1440, 1024] : [test.info().project.name === "tablet" ? 768 : 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await cards.first().getByRole("button", { name: "编辑", exact: true }).click();
    await cards.first().getByText("高级设置与英文原文", { exact: true }).click();
    await expect(cards.first().locator("code")).toHaveText(`DOMAIN-SUFFIX,${domain},DIRECT`);
    const metrics = await page.locator(".rules-editor").evaluate((element) => ({
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      documentWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
      codeWidth: element.querySelector("code")!.clientWidth, codeScrollWidth: element.querySelector("code")!.scrollWidth,
      wrapping: getComputedStyle(element.querySelector(".rule-summary strong")!).whiteSpace,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.codeScrollWidth).toBeLessThanOrEqual(metrics.codeWidth + 1);
    if (width === 360) expect(metrics.wrapping).toBe("normal");
    await page.screenshot({ path: test.info().outputPath(`rules-edit-${width}.png`) });
    await cards.first().getByRole("button", { name: "收起", exact: true }).click();
    await page.getByRole("button", { name: "高级模式", exact: true }).click();
    const table = page.locator(".rules-table");
    await expect(table.locator("tbody tr")).toHaveCount(3);
    expect(await table.locator("tbody .table-check").first().evaluate((element) => getComputedStyle(element, "::after").display)).toBe("none");
    const tableWidth = await table.evaluate((element) => ({ width: element.getBoundingClientRect().width, parentWidth: element.closest(".rules-editor")!.clientWidth, rowColor: getComputedStyle(element.querySelector("tbody tr")!).backgroundColor }));
    if (width <= 768) expect(tableWidth.width).toBeLessThanOrEqual(tableWidth.parentWidth + 1);
    expect(tableWidth.rowColor).toBe("rgb(18, 12, 33)");
    await page.screenshot({ path: test.info().outputPath(`rules-advanced-${width}.png`) });
    await page.getByRole("button", { name: "新手模式", exact: true }).click();
  }
  const longRule = cards.filter({ has: page.locator(".rule-summary strong", { hasText: domain }) });
  await longRule.getByRole("button", { name: "编辑", exact: true }).click();
  await longRule.getByRole("combobox", { name: "目标策略", exact: true }).selectOption("REJECT");
  await longRule.getByRole("button", { name: "下移规则", exact: true }).click();
  await expect(cards.nth(1)).toContainText(domain);
  await longRule.getByRole("checkbox", { name: "启用规则", exact: true }).uncheck();
  await expect(longRule.locator(".rule-summary")).toContainText("已停用");
  await longRule.getByRole("checkbox", { name: "启用规则", exact: true }).check();
  await longRule.getByRole("button", { name: "复制规则", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await expect(page.locator(".rule-issues")).not.toHaveAttribute("open", "");
  await page.locator(".rule-issues summary").click();
  await expect(page.locator(".rule-issues")).toHaveAttribute("open", "");
  const duplicates = cards.filter({ has: page.locator(".rule-summary strong", { hasText: domain }) });
  await duplicates.first().getByRole("button", { name: "删除规则", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "删除规则", exact: true });
  await expect(confirmation).toContainText("这 1 条规则");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(cards).toHaveCount(4);
  for (const card of await duplicates.all()) await card.getByRole("checkbox", { name: "选择规则", exact: true }).check();
  await page.locator(".rule-batch-bar").getByRole("button", { name: "停用", exact: true }).click();
  await expect(duplicates.first().locator(".rule-summary")).toContainText("已停用");
  await page.locator(".rule-batch-bar").getByRole("button", { name: "启用", exact: true }).click();
  await page.locator(".rule-batch-bar").getByRole("button", { name: "删除", exact: true }).click();
  await expect(confirmation).toContainText("这 2 条规则");
  await confirmation.getByRole("button", { name: "删除", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "添加规则", exact: true }).click();
  const editor = page.locator(".rule-inline-editor");
  await expect(editor).toHaveCount(1);
  await editor.locator(".rule-sentence-builder input").fill("new.example.com");
  await editor.getByRole("combobox", { name: "目标策略", exact: true }).selectOption("REJECT");
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${project.id}`)).json()).config.rules.map((rule: { value: string; target: string }) => `${rule.value}:${rule.target}`)).toEqual(["second.example.com:DIRECT", "new.example.com:REJECT", ":DIRECT"]);
  const stored = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const exported = await page.request.post("/api/tools/export", { data: { config: stored.config, format: "mihomo" } });
  expect(exported.ok(), await exported.text()).toBeTruthy();
  expect(parse(await exported.text()).rules).toEqual(["DOMAIN,second.example.com,DIRECT", "DOMAIN-SUFFIX,new.example.com,REJECT", "MATCH,DIRECT"]);
  await page.reload();
  await page.getByRole("combobox", { name: "当前配置", exact: true }).selectOption(project.id);
  await expect(cards).toHaveCount(3);
  await expect(page.locator(".rule-inline-editor")).toHaveCount(0);
});

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
  const source = page.getByRole("button", { name: "嵌套策略组 A策略组", exact: true });
  const target = page.locator(".group-overview-item").filter({ has: page.getByRole("button", { name: "选择策略组 B策略组", exact: true }) });
  const dropZone = target.locator(".group-overview-drop-target");
  const handleBox = await source.boundingBox();
  const dropBox = await dropZone.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(dropBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropBox!.x + dropBox!.width / 2, dropBox!.y + dropBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => {
    const stored = await (await page.request.get(`/api/projects/${project.id}`)).json();
    return stored.config.proxyGroups.find((group: { id: string }) => group.id === "layout-group-b")?.proxies;
  }).toContain("A策略组");
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
  await expect(probe.locator("xpath=ancestor::span[contains(@class, 'node-probe-cluster')]//span[contains(@class, 'tcp-latency')]")).toHaveClass(/tcp-latency/);
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

test("TCP 检查错误不伪报连接失败，UDP 标记不适用且复制保留国旗节点名", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/managed-nodes", { data: { name: "🇯🇵 界面回归节点", type: "vless", server: "example.com", port: 443, enabled: true, tags: [], extra: {}, uuid: "dba693d3-d530-4235-bf30-c9b30d89481" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const node = await created.json();
  const udpCreated = await page.request.post("/api/managed-nodes", { data: { name: "UDP 不适用节点", type: "hysteria2", server: "example.com", port: 443, enabled: true, tags: [], extra: {}, password: "probe-only" } });
  expect(udpCreated.ok(), await udpCreated.text()).toBeTruthy();
  const udpNode = await udpCreated.json();
  let tcpRequests = 0;
  await page.route("**/api/managed-nodes/*/tcp-ping", async (route) => {
    tcpRequests += 1;
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "节点检测服务暂不可用" }) });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { window.name = value; } } });
  });
  await page.route("**/api/managed-nodes/*/country-flag", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ node: { ...node, name: "🇯🇵 界面回归节点" }, location: { ip: "203.0.113.10", countryCode: "JP", country: "日本", flag: "🇯🇵" } }) }));
  await page.goto("/app/nodes");
  const row = (name: string) => page.locator(".node-row").filter({ has: page.getByRole("button", { name: `检测节点 ${name}`, exact: true }) });
  const regularRow = row(node.name);
  await expect(regularRow).toBeVisible();
  await regularRow.getByRole("button", { name: `检测节点 ${node.name}`, exact: true }).click();
  await expect(regularRow.locator(".tcp-latency")).toHaveText("检查错误");
  await expect(regularRow.getByText("失败", { exact: true })).toHaveCount(0);
  await regularRow.getByRole("button", { name: `复制 ${node.name} 的协议链接`, exact: true }).click();
  const link = await page.evaluate(() => window.name);
  expect(link).toMatch(/^vless:\/\//);
  expect(decodeURIComponent(new URL(link).hash.slice(1))).toBe(node.name);
  expect(link).not.toContain("/api/generated-subscriptions/");
  await regularRow.getByRole("button", { name: `为 ${node.name} 添加国家国旗`, exact: true }).click();
  const renamedRow = page.locator(".node-row").filter({ has: page.getByRole("button", { name: "检测节点 🇯🇵 界面回归节点", exact: true }) });
  await expect(renamedRow.locator(".node-row-name strong")).toHaveText("🇯🇵 界面回归节点");
  expect(await renamedRow.locator(".node-diagnostic.location").count()).toBeLessThanOrEqual(1);

  const udpRow = row(udpNode.name);
  await expect(udpRow).toBeVisible();
  await udpRow.getByRole("button", { name: `检测节点 ${udpNode.name}`, exact: true }).click();
  await expect(udpRow.locator(".tcp-latency")).toHaveText("不适用");
  expect(tcpRequests).toBe(1);
});

test("分组工作台优先展示成员，普通与全屏布局都能新增和嵌套", async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const created = await page.request.post("/api/projects", { data: { name: `工作台空间-${test.info().project.name}` } });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const proxies = Array.from({ length: 32 }, (_, index) => ({ id: `workbench-node-${index}`, name: `工作台节点 ${index}`, type: "http", server: "example.com", port: 8080, extra: {} }));
  const config = { ...project.config, proxies, proxyGroups: [{ id: "workbench-parent", name: "主策略组", type: "select", proxies: proxies.map((node) => node.name), extra: {} }], rules: [] };
  const saved = await page.request.put(`/api/projects/${project.id}`, { data: { ...project, config } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto("/app/workspace/groups");
  await page.getByRole("combobox", { name: "当前配置" }).selectOption(project.id);
  await expect(page.getByRole("heading", { name: "主策略组", exact: true })).toBeVisible();
  const widths = test.info().project.name === "desktop" ? [1440, 1024] : [test.info().project.name === "mobile" ? 360 : 768];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.locator(".groups-content").evaluate((element) => Math.round(element.getBoundingClientRect().right))).toBe(width);
    const layout = await page.locator(".group-board").evaluate((element) => {
      const content = element.closest(".content-area")!;
      return { board: element.getBoundingClientRect().toJSON(), contentHeight: content.clientHeight, scrollHeight: content.scrollHeight };
    });
    expect(layout.board.y).toBeLessThan(350);
    expect(layout.board.height).toBeGreaterThan(420);
    expect(layout.board.bottom).toBeLessThanOrEqual(800);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.contentHeight + 1);
    const controls = page.getByRole("navigation", { name: "分组工作台区域" });
    if (await controls.isVisible()) {
      for (const name of ["全部分组", "添加内容", "当前组"]) {
        await controls.getByRole("button", { name, exact: true }).click();
        await expect(page.locator(".group-board")).toBeVisible();
        expect(await page.locator(".group-board").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
      }
    }
  }
  await page.getByRole("button", { name: "全屏编辑代理分组", exact: true }).click();
  const workbench = page.getByRole("dialog", { name: "分组工作台", exact: true });
  await expect(workbench).toBeVisible();
  const add = workbench.getByRole("button", { name: "添加策略组", exact: true });
  await add.click();
  const editor = page.getByRole("dialog", { name: "添加策略组", exact: true });
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(workbench).toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await editor.getByLabel("策略组名称", { exact: true }).fill("全屏新增组");
  await editor.getByRole("button", { name: "保存策略组", exact: true }).click();
  const controls = workbench.getByRole("navigation", { name: "分组工作台区域" });
  if (await controls.isVisible()) await controls.getByRole("button", { name: "全部分组", exact: true }).click();
  await workbench.getByRole("button", { name: "选择策略组 主策略组", exact: true }).click();
  if (await controls.isVisible()) await controls.getByRole("button", { name: "当前组", exact: true }).click();
  await workbench.locator(".nest-group-list").getByRole("button", { name: "全屏新增组", exact: true }).click();
  await expect(workbench.locator(".nest-group-list").getByRole("button", { name: "全屏新增组", exact: true })).toBeDisabled();
  await workbench.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(workbench).toHaveCount(0);
  await expect.poll(async () => {
    const stored = await (await page.request.get(`/api/projects/${project.id}`)).json();
    return stored.config.proxyGroups.find((group: { id: string }) => group.id === "workbench-parent").proxies;
  }).toContain("全屏新增组");
});

test("短表单随内容收缩，长预览与矮屏只滚动正文", async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/nodes");
  await page.getByRole("button", { name: "导入链接", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "导入节点链接", exact: true });
  await expect(dialog).toBeVisible();
  const originalSize = page.viewportSize()!;
  const initialBox = await dialog.boundingBox();
  expect(initialBox!.height).toBeLessThan(originalSize.height - 100);
  const host = `${"long-server-address".repeat(3)}.${"long-server-address".repeat(3)}.example.com`;
  await dialog.getByLabel("订阅 URL 或节点链接", { exact: true }).fill(Array.from({ length: 10 }, (_, index) => `vless://dba693d3-d530-4235-bf30-cb9c30d89481@${host}:${10443 + index}#${encodeURIComponent("导入预览长名称".repeat(6) + index)}`).join("\n"));
  await dialog.getByRole("button", { name: "解析预览", exact: true }).click();
  await expect(dialog.locator(".import-preview")).toContainText("解析结果：10 个节点");
  await page.setViewportSize({ width: originalSize.width, height: 460 });
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  const dimensions = await dialog.evaluate((element) => {
    const body = element.querySelector<HTMLElement>(".drawer-body")!;
    const footer = element.querySelector("footer")!;
    return { rect: element.getBoundingClientRect().toJSON(), footer: footer.getBoundingClientRect().toJSON(), bodyWidth: body.clientWidth, contentWidth: body.scrollWidth, bodyHeight: body.clientHeight, contentHeight: body.scrollHeight };
  });
  expect(dimensions.rect.x).toBeGreaterThanOrEqual(0);
  expect(dimensions.rect.right).toBeLessThanOrEqual(originalSize.width);
  expect(dimensions.rect.y).toBeGreaterThanOrEqual(0);
  expect(dimensions.footer.bottom).toBeLessThanOrEqual(460);
  expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.bodyWidth + 1);
  expect(dimensions.contentHeight).toBeGreaterThan(dimensions.bodyHeight);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("节点操作在断点、诊断结果和展开更多时不越界", async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nodeName = `操作排版验收节点-${test.info().project.name}`;
  const response = await page.request.post("/api/managed-nodes", { data: { name: nodeName, type: "vless", server: "example.com", port: 443, enabled: true, tags: [], extra: {}, uuid: "dba693d3-d530-4235-bf30-cb9c30d89481" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto("/app/nodes");
  await page.getByPlaceholder("搜索名称、地址、协议、标签或备注").fill(nodeName);
  await page.route("**/api/managed-nodes/*/tcp-ping", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reachable: true, latencyMs: 9999, resolvedAddress: "1.1.1.1" }) }));
  const row = page.locator(".node-row");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: `检测节点 ${nodeName}`, exact: true }).click();
  await expect(row.locator(".tcp-latency")).toHaveText("9999ms");
  const widths = test.info().project.name === "desktop" ? [1440, 1320, 1250, 1024] : [page.viewportSize()!.width, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => row.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
    const more = row.getByRole("button", { name: `更多操作 ${nodeName}`, exact: true });
    if (await more.isVisible() && await more.getAttribute("aria-expanded") === "false") await more.click();
    await expect(row.getByRole("button", { name: `编辑 ${nodeName}`, exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: `复制 ${nodeName} 的协议链接`, exact: true })).toContainText("复制节点链接");
    const geometry = await row.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const actions = element.querySelector(".node-row-actions")!.getBoundingClientRect();
      const buttons = [...element.querySelectorAll(".node-row-actions button, .tcp-latency")].filter((button) => button.getClientRects().length > 0).map((button) => button.getBoundingClientRect());
      return { bounds: bounds.toJSON(), actions: actions.toJSON(), buttons: buttons.map((button) => button.toJSON()) };
    });
    for (const button of geometry.buttons) {
      expect(button.x).toBeGreaterThanOrEqual(geometry.bounds.x);
      expect(button.right).toBeLessThanOrEqual(geometry.bounds.right + 1);
      expect(button.bottom).toBeLessThanOrEqual(geometry.bounds.bottom + 1);
    }
    if (width === 360) expect(geometry.actions.x - geometry.bounds.x).toBeLessThan(20);
  }
});
