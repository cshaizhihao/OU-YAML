import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const share = "vless://dba693d3-d530-4235-bf30-cb9c30d89481@1.1.1.1:443?security=tls&sni=example.com#测试节点-长名称-支持完整展示";
let loginCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;

async function login(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (loginCookies) await page.context().addCookies(loginCookies);
  await page.goto("/");
  if (await page.getByLabel("账号", { exact: true }).isVisible().catch(() => false)) {
    await page.getByLabel("账号", { exact: true }).fill("admin");
    await page.locator('input[autocomplete="current-password"]').fill("ou-yaml-e2e-12345");
    await page.getByRole("button", { name: "登录", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "开始三步教程" })).toBeVisible();
  loginCookies = await page.context().cookies();
  return errors;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
}

test("三步教程真实导入、发布、复制与原链接同步", async ({ page }) => {
  const errors = await login(page);
  await page.getByRole("button", { name: "开始三步教程" }).click();
  await page.getByRole("textbox", { name: "订阅 URL、分享链接或配置内容" }).fill(share);
  await page.route("**/api/node-sources/*/import", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "未识别到节点，请检查内容格式" }) }));
  await page.getByRole("button", { name: "导入并继续" }).click();
  await expect(page.getByRole("alert")).toContainText("导入未完成，已有订阅未改变");
  await expect(page.getByRole("dialog", { name: /粘贴并导入订阅/ })).toBeVisible();
  await page.unroute("**/api/node-sources/*/import");
  await page.getByRole("button", { name: "导入并继续" }).click();
  await expect(page.getByRole("dialog", { name: /选择推荐配置并发布/ })).toBeVisible();
  await page.getByRole("button", { name: /简洁代理/ }).click();
  await page.getByRole("button", { name: /^(生成我的订阅|检查发布变化)$/ }).click();
  await expect(page.getByRole("region", { name: "发布前确认" })).toBeVisible();
  await page.getByRole("button", { name: "确认并发布", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订阅已发布", exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await page.getByRole("button", { name: "复制订阅链接", exact: true }).click();
  await expect(page.getByRole("button", { name: /打开新手教程/ })).toBeVisible();
  const url = await page.locator(".quick-result code").innerText();
  const before = await page.request.get(url);
  expect(before.ok()).toBeTruthy();
  expect(await before.text()).toContain("测试节点");
  const subscriptions = await (await page.request.get("/api/generated-subscriptions")).json();
  const subscription = subscriptions[0];
  const nodes = await (await page.request.get("/api/managed-nodes")).json();
  const profiles = await (await page.request.get("/api/generation-profiles")).json();
  const profile = profiles.find((item: { id: string }) => item.id === subscription.profileId);
  const node = nodes.find((item: { id: string }) => profile.nodeIds.includes(item.id));
  const update = await page.request.put(`/api/managed-nodes/${node.id}`, { data: { ...node, port: 8443 } });
  expect(update.ok()).toBeTruthy();
  const sync = await page.request.post(`/api/generation-profiles/${subscription.profileId}/sync`);
  expect(sync.ok()).toBeTruthy();
  expect(await (await page.request.get(url)).text()).toContain("8443");
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("quick-result.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("演示不写数据、规则中文编辑、主要页面无横向溢出", async ({ page }) => {
  const errors = await login(page);
  await page.getByRole("button", { name: "暂时跳过" }).click();
  const before = await (await page.request.get("/api/managed-nodes")).json();
  await expect(page.getByRole("button", { name: /创建新订阅/ })).toBeVisible();
  await page.goto("/app/home?step=0");
  await page.getByRole("button", { name: "先看演示" }).click();
  await page.getByRole("button", { name: "继续演示" }).click();
  await page.getByRole("button", { name: "继续演示" }).click();
  await page.getByRole("button", { name: "开始真实配置" }).click();
  expect(await (await page.request.get("/api/managed-nodes")).json()).toEqual(before);
  const widths = test.info().project.name === "desktop" ? [1440, 1024] : [test.info().project.name === "tablet" ? 768 : 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/app/home", "/app/sources", "/app/nodes", "/app/workspace/groups", "/app/workspace/rules", "/app/publish/links", "/app/system/settings"]) {
      await page.goto(route);
      await expect(page.locator(".main-shell").first()).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: test.info().outputPath(`${route.split("/").pop()}-${width}.png`), fullPage: true });
    }
  }
  await page.goto("/app/workspace/rules");
  await expect(page.locator('[data-guide-id="rule-scenario"]')).toBeVisible();
  await page.getByLabel("网站域名", { exact: true }).fill("example.com");
  await page.getByRole("combobox", { name: "连接方式", exact: true }).selectOption("DIRECT");
  await page.getByRole("button", { name: "添加网站规则", exact: true }).click();
  await page.getByRole("button", { name: "检查匹配结果", exact: true }).click();
  await expect(page.locator(".rule-scenario [role=status]")).toContainText("直接连接（DIRECT）");
  const projectId = await page.getByRole("combobox", { name: "当前配置" }).inputValue();
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${projectId}`)).json()).config.rules[0].value).toBe("example.com");
  const project = await (await page.request.get(`/api/projects/${projectId}`)).json();
  expect(project.config.rules[0].type).toBe("DOMAIN-SUFFIX");
  expect(project.config.rules.at(-1).type).toBe("MATCH");
  expect(errors).toEqual([]);
});

test("已生成订阅可改名、再次编辑分组和分流，更新仍保留原链接", async ({ page }) => {
  const errors = await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (test.info().project.name === "mobile") await page.setViewportSize({ width: 360, height: 844 });
  await page.getByRole("button", { name: "暂时跳过" }).click();
  const created = await page.request.post("/api/projects", { data: { name: `首页验收-${test.info().project.name}` } });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id;
  await page.goto("/app/home?step=0");
  await page.getByRole("combobox", { name: "当前配置" }).selectOption(projectId);
  await page.getByRole("textbox", { name: "订阅 URL、分享链接或配置内容" }).fill(share);
  await page.getByRole("button", { name: "导入并继续" }).click();
  await page.getByRole("button", { name: /简洁代理/ }).click();
  const name = `我的日常订阅-${test.info().project.name}`;
  await page.getByLabel("订阅名称", { exact: true }).fill(name);
  await page.getByRole("button", { name: "手动编辑分组后再发布", exact: true }).click();
  await page.getByRole("button", { name: "编辑 节点选择", exact: true }).click();
  await page.getByLabel("策略组名称", { exact: true }).fill("办公线路");
  await page.getByRole("button", { name: "保存策略组", exact: true }).click();
  await page.getByRole("button", { name: "下一步：生成订阅", exact: true }).click();
  await expect(page.getByLabel("订阅名称", { exact: true })).toHaveValue(name);
  await page.getByRole("button", { name: "生成我的订阅", exact: true }).click();
  await expect(page.getByRole("heading", { name: "确认创建订阅" })).toBeVisible();
  const before = await (await page.request.get("/api/generated-subscriptions")).json();
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  expect(await (await page.request.get("/api/generated-subscriptions")).json()).toEqual(before);
  await page.getByRole("button", { name: "生成我的订阅", exact: true }).click();
  await page.getByRole("button", { name: "确认并发布", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订阅已发布", exact: true })).toBeVisible();
  const url = await page.locator(".quick-result code").innerText();
  expect(await (await page.request.get(url)).text()).toContain("办公线路");
  await page.getByRole("button", { name: "回到我的订阅", exact: true }).click();
  let card = page.getByRole("article", { name, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "重命名", exact: true }).click();
  const renamed = `我的主力订阅-${test.info().project.name}`;
  const nameInput = page.getByRole("dialog", { name: "重命名订阅" }).getByLabel("订阅名称", { exact: true });
  await nameInput.fill("");
  await nameInput.pressSequentially(renamed, { delay: 15 });
  await expect(nameInput).toBeFocused();
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  card = page.getByRole("article", { name: renamed, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("内容 v1");
  await page.reload();
  card = page.getByRole("article", { name: renamed, exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator(".quick-setup")).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("subscription-home.png"), fullPage: true });
  const extraName = `新增订阅节点-${test.info().project.name}`;
  const extraNode = await page.request.post("/api/managed-nodes", { data: { name: extraName, type: "http", server: "example.com", port: 8443, enabled: true, tags: [], extra: {} } });
  expect(extraNode.ok(), await extraNode.text()).toBeTruthy();
  await card.getByRole("button", { name: "编辑分组", exact: true }).click();
  await expect(page.locator(".subscription-editor")).toBeVisible();
  const layout = await page.locator(".subscription-editor").evaluate((element) => {
    const content = element.closest(".content-area")!;
    return { board: element.querySelector(".group-board")!.getBoundingClientRect().toJSON(), footer: element.querySelector(".editor-publish")!.getBoundingClientRect().toJSON(), viewport: window.innerHeight, contentHeight: content.clientHeight, scrollHeight: content.scrollHeight };
  });
  expect(layout.board.y).toBeLessThan(360);
  expect(layout.board.bottom).toBeLessThan(layout.footer.top);
  expect(layout.footer.bottom).toBeLessThanOrEqual(layout.viewport);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.contentHeight + 1);
  await page.getByRole("button", { name: "订阅信息", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "订阅信息", exact: true })).toContainText(renamed);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "1. 选择节点", exact: true }).click();
  await page.getByRole("textbox", { name: "筛选订阅节点", exact: true }).fill(extraName);
  const choice = page.locator(".editor-node-list label").filter({ hasText: extraName });
  const checkbox = choice.getByRole("checkbox");
  await checkbox.check();
  const checkBox = await checkbox.boundingBox();
  expect(checkBox!.width).toBeLessThanOrEqual(24);
  expect(checkBox!.height).toBeLessThanOrEqual(24);
  await page.getByRole("button", { name: "应用节点选择，继续编辑分组", exact: true }).click();
  await expect(page.locator(".editor-publish-status")).toContainText("有未发布修改");
  expect(await (await page.request.get(url)).text()).not.toContain(extraName);
  await page.getByRole("button", { name: "编辑 办公线路", exact: true }).click();
  await page.getByLabel("策略组名称", { exact: true }).fill("通勤线路");
  await page.getByRole("button", { name: "保存策略组", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "返回我的订阅", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑已生成的订阅" })).toBeVisible();
  expect(await (await page.request.get(url)).text()).not.toContain("通勤线路");
  await page.getByRole("button", { name: "检查并更新原订阅", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "确认更新原订阅", exact: true });
  await expect(confirmation).toBeVisible();
  await page.route("**/api/generated-subscriptions/*/editor", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "订阅已被其他操作更新，请重新载入后再试。" }) }));
  await confirmation.getByRole("button", { name: "确认更新原订阅", exact: true }).click();
  await expect(page.locator(".editor-feedback").getByRole("alert")).toContainText("请重新载入");
  expect(await (await page.request.get(url)).text()).not.toContain("通勤线路");
  const footerAfterError = await page.locator(".editor-publish").boundingBox();
  expect(footerAfterError!.y + footerAfterError!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.unroute("**/api/generated-subscriptions/*/editor");
  await page.getByRole("button", { name: "检查并更新原订阅", exact: true }).click();
  await page.getByRole("button", { name: "确认更新原订阅", exact: true }).click();
  await expect(page.locator('[data-guide-id="subscription-saved"]')).toContainText("已更新原订阅");
  expect(await (await page.request.get(url)).text()).toContain("通勤线路");
  await page.getByRole("button", { name: "返回我的订阅", exact: true }).click();
  await page.getByRole("button", { name: /让某个网站走指定线路/ }).click();
  await expect(page.getByRole("dialog", { name: /先选中要修改的订阅/ })).toBeVisible();
  await page.getByRole("article", { name: renamed, exact: true }).getByRole("button", { name: "编辑分流", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /为网站选择连接方式/ })).toBeVisible();
  await page.getByLabel("网站域名", { exact: true }).fill("novice.example.com");
  await page.getByRole("combobox", { name: "连接方式", exact: true }).selectOption("DIRECT");
  await page.getByRole("button", { name: "添加网站规则", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /把规则更新到原订阅/ })).toBeVisible();
  if (page.viewportSize()!.width <= 840) {
    await expect.poll(async () => {
      const footer = await page.locator(".editor-publish").boundingBox();
      const guide = await page.locator(".guided-tour-popover").boundingBox();
      return Boolean(footer && guide && footer.y + footer.height < guide.y);
    }).toBe(true);
  }
  expect(await (await page.request.get(url)).text()).not.toContain("novice.example.com");
  await page.getByRole("button", { name: "检查并更新原订阅", exact: true }).click();
  await expect(page.getByRole("region", { name: "更新原订阅确认" })).toContainText("原地址与有效期保持不变");
  await expect(page.locator(".guided-tour-popover")).toHaveCount(0);
  await page.getByRole("button", { name: "返回修改", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /把规则更新到原订阅/ })).toBeVisible();
  await page.getByRole("button", { name: "检查并更新原订阅", exact: true }).click();
  await noOverflow(page);
  await page.getByRole("button", { name: "确认更新原订阅", exact: true }).click();
  expect(await (await page.request.get(url)).text()).toContain("DOMAIN-SUFFIX,novice.example.com,DIRECT");
  await page.getByRole("button", { name: "返回我的订阅", exact: true }).click();
  await page.getByRole("button", { name: /订阅不能用，怎么办/ }).click();
  await expect(page.getByRole("dialog", { name: /先判断哪里出了问题/ })).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /客户端能导入，服务器却报错/ })).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /地址正常但连不上网络/ })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("长列表分页、长名称和键盘拖拽持久化", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "暂时跳过" }).click();
  const label = `分页验收-${test.info().project.name}-${test.info().repeatEachIndex}`;
  const sourceResponse = await page.request.post("/api/node-sources", { data: { name: label, kind: "file", format: "auto", enabled: true, intervalMinutes: 0 } });
  expect(sourceResponse.ok()).toBeTruthy();
  const source = await sourceResponse.json();
  const links = Array.from({ length: 105 }, (_, index) => share.replace("1.1.1.1:443", `1.1.1.1:${10000 + index}`).split("#")[0] + `#${encodeURIComponent(`${label}-${index}-` + "一个很长的中文节点名称".repeat(5))}`).join("\n");
  const imported = await page.request.post(`/api/node-sources/${source.id}/import`, { data: links, headers: { "Content-Type": "text/plain" } });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  await page.goto("/app/nodes");
  await page.getByPlaceholder("搜索名称、地址、协议、标签或备注").fill(label);
  await expect(page.locator(".node-row")).toHaveCount(100);
  await noOverflow(page);
  const firstName = await page.locator(".node-row .node-name-stack strong").first().innerText();
  const secondName = await page.locator(".node-row .node-name-stack strong").nth(1).innerText();
  const handle = page.getByRole("button", { name: `拖动节点 ${firstName}`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".node-drag-overlay")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const importedNodes = (await imported.json()).nodes;
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(`droppable area node:${importedNodes[1].id}`);
  await page.keyboard.press("Space");
  await expect(page.locator(".node-row .node-name-stack strong").first()).toHaveText(secondName);
  await expect.poll(async () => {
    const nodes = await (await page.request.get("/api/managed-nodes")).json();
    return nodes.filter((node: { sourceId: string }) => node.sourceId === source.id)[0].name;
  }).toBe(secondName);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".node-row")).toHaveCount(5);
  await noOverflow(page);
});
