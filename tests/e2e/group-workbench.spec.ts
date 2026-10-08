import { test, expect, type Page, type CDPSession } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  const account = page.getByLabel("账号", { exact: true });
  if (await account.isVisible().catch(() => false)) {
    await account.fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("ou-yaml-e2e-12345");
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "开始三步教程" })).toBeVisible();
  await page.getByRole("button", { name: "暂时跳过" }).click();
}

async function createGroupProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", { data: { name } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const project = await response.json();
  const node = { id: "group-workbench-node", name: "香港出口", type: "http", server: "127.0.0.1", port: 8080, extra: {} };
  const config = {
    ...project.config,
    proxies: [node],
    proxyGroups: [
      { id: "group-workbench-a", name: "节点入口", type: "select", proxies: [node.name], extra: {} },
      { id: "group-workbench-b", name: "自动优选", type: "url-test", proxies: ["DIRECT"], extra: {} },
      { id: "group-workbench-relay", name: "出口链", type: "relay", proxies: [node.name], extra: {} },
    ],
    rules: [{ id: "group-workbench-rule", type: "MATCH", value: "", target: "节点入口", options: [], enabled: true }],
  };
  const saved = await page.request.put(`/api/projects/${project.id}`, { data: { ...project, config } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  return { id: project.id as string, name: "节点入口", groups: config.proxyGroups };
}

async function openProject(page: Page, projectId: string) {
  await page.goto("/app/workspace/groups");
  await page.getByRole("combobox", { name: "当前配置", exact: true }).selectOption(projectId);
  await expect(page.getByRole("heading", { name: "节点入口", exact: true })).toBeVisible();
}

async function touchGroup(page: Page, session: CDPSession, handleName: string, targetName: string, accepted = true) {
  const source = page.getByRole("button", { name: handleName, exact: true });
  const target = page.locator(".group-overview-item").filter({ has: page.getByRole("button", { name: `选择策略组 ${targetName}`, exact: true }) });
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  const rows = page.locator(".group-overview-item");
  const before = await rows.evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }));
  const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  await expect(page.locator(".drag-overlay")).toBeVisible();
  expect(await rows.evaluateAll((elements) => elements.map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }))).toEqual(before);
  for (let step = 1; step <= 8; step++) {
    const progress = step / 8;
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress }] });
    await page.waitForTimeout(35);
  }
  if (handleName.startsWith("嵌套")) {
    if (accepted) await expect(target).toHaveClass(/nesting-over/);
    else await expect(target).not.toHaveClass(/nesting-over/);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".drag-overlay")).toHaveCount(0);
}

test("全部分组总览、当前成员和添加内容在桌面与移动端都可访问", async ({ page }) => {
  await login(page);
  const project = await createGroupProject(page, `分组总览-${test.info().project.name}`);
  await openProject(page, project.id);
  const overview = page.getByRole("complementary", { name: "全部策略组" });
  const pool = page.getByRole("complementary", { name: "当前配置节点" });
  const members = page.getByRole("region", { name: "当前策略组成员" });
  if (test.info().project.name !== "desktop") {
    const tabs = page.getByRole("navigation", { name: "分组工作台区域" });
    await expect(tabs.getByRole("button", { name: "全部分组", exact: true })).toBeVisible();
    await tabs.getByRole("button", { name: "全部分组", exact: true }).click();
    await expect(overview).toBeVisible();
    await expect(overview).toContainText("节点入口");
    await expect(overview).toContainText("手动选择");
    await expect(overview).toContainText("1");
    await expect(overview).toContainText("自动优选");
    await expect(overview).toContainText("自动测速");
    await overview.getByRole("button", { name: "选择策略组 自动优选", exact: true }).click();
    await tabs.getByRole("button", { name: "当前组", exact: true }).click();
    await expect(members).toContainText("DIRECT");
    await tabs.getByRole("button", { name: "添加内容", exact: true }).click();
    await expect(pool).toBeVisible();
    await expect(pool).toContainText("添加到 自动优选");
    await expect(pool).toContainText("香港出口");
  } else {
    await expect(overview).toBeVisible();
    await expect(overview).toContainText("节点入口");
    await expect(overview).toContainText("手动选择");
    await expect(overview.locator(".group-overview-select b").first()).toHaveText("1");
    await expect(members).toContainText("香港出口");
    await expect(pool).toBeVisible();
    await expect(page.getByRole("complementary", { name: "策略组属性" })).toContainText("1 条规则使用");
  }
  expect(await page.locator(".group-board").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
});

test("触摸拖动策略组到目标组后自动保存并在重载后保留", async ({ page, context }) => {
  test.skip(test.info().project.name !== "mobile", "实际触摸拖拽回归在移动端 Chromium 项目运行");
  await login(page);
  const project = await createGroupProject(page, "分组触摸拖拽与持久化");
  await openProject(page, project.id);
  const tabs = page.getByRole("navigation", { name: "分组工作台区域" });
  await tabs.getByRole("button", { name: "全部分组", exact: true }).click();
  const session = await context.newCDPSession(page);
  await touchGroup(page, session, "嵌套策略组 节点入口", "自动优选");
  await expect.poll(async () => {
    const response = await page.request.get(`/api/projects/${project.id}`);
    const saved = await response.json();
    return saved.config.proxyGroups.find((group: { id: string; proxies: string[] }) => group.id === "group-workbench-b")?.proxies;
  }).toContain("节点入口");
  await touchGroup(page, session, "嵌套策略组 自动优选", "节点入口", false);
  await touchGroup(page, session, "嵌套策略组 节点入口", "出口链", false);
  await touchGroup(page, session, "调整策略组顺序 节点入口", "自动优选");
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
    return saved.config.proxyGroups;
  }).toEqual([{ ...project.groups[1], proxies: ["DIRECT", "节点入口"] }, project.groups[0], project.groups[2]]);
  await page.reload();
  await page.getByRole("combobox", { name: "当前配置", exact: true }).selectOption(project.id);
  await page.getByRole("navigation", { name: "分组工作台区域" }).getByRole("button", { name: "全部分组", exact: true }).click();
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
    return saved.config.proxyGroups.find((group: { id: string; proxies: string[] }) => group.id === "group-workbench-b")?.proxies;
  }).toContain("节点入口");
  await expect(page.locator(".group-overview-item").first()).toContainText("自动优选");
  await page.getByRole("button", { name: "选择策略组 自动优选", exact: true }).click();
  await page.getByRole("navigation", { name: "分组工作台区域" }).getByRole("button", { name: "当前组", exact: true }).click();
  await expect(page.getByRole("region", { name: "当前策略组成员" })).toContainText("节点入口");
  await expect(page.locator(".group-overview-item")).toHaveCount(3);
  await session.detach();
});

test("键盘拖动可调整总览组顺序并持久化", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "键盘排序回归在桌面 Chromium 项目运行");
  await login(page);
  const project = await createGroupProject(page, "分组键盘顺序与持久化");
  await openProject(page, project.id);
  const source = page.getByRole("button", { name: "调整策略组顺序 节点入口", exact: true });
  const rows = page.locator(".group-overview-item");
  await source.focus();
  await page.keyboard.press("Space");
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(source).not.toHaveAttribute("aria-pressed", "true");
  await expect(rows.first()).toContainText("节点入口");
  await source.focus();
  await page.keyboard.press("Space");
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(source).not.toHaveAttribute("aria-pressed", "true");
  await expect(rows.first()).toContainText("节点入口");
  await source.focus();
  await page.keyboard.press("Space");
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).not.toHaveCSS("transform", "none");
  await page.keyboard.press("Space");
  await expect(rows.first()).toContainText("自动优选");
  await expect.poll(async () => {
    const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
    return saved.config.proxyGroups.map((group: { id: string }) => group.id);
  }).toEqual(["group-workbench-b", "group-workbench-a", "group-workbench-relay"]);
  await page.reload();
  await page.getByRole("combobox", { name: "当前配置", exact: true }).selectOption(project.id);
  await expect(page.locator(".group-overview-item").first()).toContainText("自动优选");
});
