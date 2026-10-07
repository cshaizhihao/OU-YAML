import assert from "node:assert/strict";
import { test } from "node:test";
import { getRuleDefinition, ruleCatalog, ruleSentence, ruleSourcePreview, ruleTargetLabel } from "../src/shared/ruleCatalog";

test("标准规则类型都有中文说明和示例", () => {
  assert.equal(new Set(ruleCatalog.map((item) => item.type)).size, ruleCatalog.length);
  for (const item of ruleCatalog) {
    assert.ok(item.label.length >= 4, item.type);
    assert.ok(item.description.length >= 8, item.type);
    assert.equal(getRuleDefinition(item.type), item);
  }
});

test("中文展示不改变标准英文规则源码", () => {
  const rule = { id: "rule-1", type: "DOMAIN-SUFFIX", value: "example.com", target: "DIRECT", options: ["no-resolve"], enabled: true };
  assert.equal(ruleSentence(rule), "当 域名后缀匹配“example.com” 时，使用 直接连接");
  assert.equal(ruleTargetLabel("DIRECT"), "直接连接（DIRECT）");
  assert.equal(ruleSourcePreview(rule), "DOMAIN-SUFFIX,example.com,DIRECT,no-resolve");
});
