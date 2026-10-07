import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyConfig } from "../src/shared/types";
import { duplicateRule, createScenarioRule, explainDomain, inspectRules } from "../src/shared/ruleTools";
import { previewExport } from "../src/shared/exportConfig";

test("复制规则保留末尾兜底，网站场景拒绝 URL 和错误域名", () => {
  const config = createEmptyConfig();
  const rule = createScenarioRule("Example.COM", "DIRECT");
  const rules = duplicateRule([rule, ...config.rules], rule);
  assert.equal(rules.at(-1)?.type, "MATCH");
  assert.equal(rules.length, 3);
  assert.notEqual(rules[0].id, rules[1].id);
  assert.throws(() => createScenarioRule("https://example.com/path", "DIRECT"), /只填写域名/);
  assert.throws(() => createScenarioRule("bad..com", "DIRECT"), /格式无效/);
  assert.equal(inspectRules(rules).length, 1);
});

test("域名匹配区分后缀边界并提示前置不确定规则", () => {
  const rule = createScenarioRule("example.com", "DIRECT");
  const rules = [rule, ...createEmptyConfig().rules];
  assert.equal(explainDomain(rules, "www.example.com").rule?.target, "DIRECT");
  assert.equal(explainDomain(rules, "notexample.com").rule?.type, "MATCH");
  assert.deepEqual(explainDomain([{ ...rule, type: "GEOSITE", value: "cn" }, ...rules], "example.com").uncertain, ["GEOSITE"]);
});

test("不支持的 sing-box 转换返回明确错误，不丢弃规则或改变分组", () => {
  const config = createEmptyConfig();
  config.proxyGroups[0].type = "relay";
  config.rules.unshift({ ...createScenarioRule("example.com", "DIRECT"), type: "GEOSITE" });
  const result = previewExport(config, "sing-box");
  assert.equal(result.content, "");
  assert.ok(result.issues.some((issue) => issue.message.includes("relay")));
  assert.ok(result.issues.some((issue) => issue.message.includes("GEOSITE")));
});
