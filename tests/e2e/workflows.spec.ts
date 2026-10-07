import { test, expect, type Page } from "@playwright/test";

const share = "vless://dba693d3-d530-4235-bf30-cb9c30d89481@1.1.1.1:443?security=tls&sni=example.com#测试节点-长名称-支持完整展示";

async function login(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("admin");
  await page.locator('input[autocomplete="current-password"]').fill("ou-yaml-e2e-12345");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始三步教程" })).toBeVisible();
  return errors;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(2);
}

test("三步教程真实导入、发布、复制与原链接同步", async ({ page }) => {
  const errors = await login(page);
  await page.getByRole("button", { name: "开始三步教程" }).click();
  await page.getByRole("textbox", { name: "订阅 URL、分享链接或配置内容" }).fill(share);
  await page.getByRole("button", { name: "导入并继续" }).click();
  await expect(page.getByRole("dialog", { name: /选择推荐配置并发布/ })).toBeVisible();
  await page.getByRole("button", { name: /简洁代理/ }).click();
  await page.getByRole("button", { name: "生成我的订阅", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订阅已发布", exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await page.getByRole("button", { name: "复制订阅链接", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /随时继续学习/ })).toBeVisible();
  await page.getByRole("button", { name: "完成教程" }).click();
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
  await page.getByRole("button", { name: "先看演示" }).click();
  await page.getByRole("button", { name: "继续演示" }).click();
  await page.getByRole("button", { name: "继续演示" }).click();
  await page.getByRole("button", { name: "开始真实配置" }).click();
  expect(await (await page.request.get("/api/managed-nodes")).json()).toEqual(before);
  for (const route of ["/app/home", "/app/sources", "/app/nodes", "/app/workspace/groups", "/app/workspace/rules", "/app/publish/links", "/app/system/settings"]) {
    await page.goto(route);
    await expect(page.locator(".main-shell").first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`${route.split("/").pop()}.png`), fullPage: true });
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
