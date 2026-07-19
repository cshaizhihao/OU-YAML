import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMihomoYaml } from "../src/shared/mihomo";
import { applyRuleTemplate } from "../src/shared/ruleTemplates";

const fixture = `
proxies: []
proxy-groups:
  - name: Proxy
    type: select
    proxies: [DIRECT]
rules:
  - DOMAIN,old.example,Proxy
  - MATCH,Proxy
`;

test("追加规则模板并保留唯一的末尾 MATCH", () => {
  const config = parseMihomoYaml(fixture);
  const output = applyRuleTemplate(config, "developer", "Proxy", "append");
  assert.equal(output.rules.filter((rule) => rule.type === "MATCH").length, 1);
  assert.equal(output.rules.at(-1)?.type, "MATCH");
  assert.ok(output.rules.some((rule) => rule.value === "github.com" && rule.target === "Proxy"));
});

test("替换规则模板时自动补充兜底规则", () => {
  const config = parseMihomoYaml(fixture);
  const output = applyRuleTemplate(config, "ads-block", "Proxy", "replace");
  assert.deepEqual(output.rules.map((rule) => rule.type), ["GEOSITE", "MATCH"]);
  assert.equal(output.rules[0].target, "REJECT");
  assert.equal(output.rules[1].target, "Proxy");
});

