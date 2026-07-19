import assert from "node:assert/strict";
import { test } from "node:test";
import YAML from "yaml";
import { exportMihomoYaml, parseMihomoYaml, validateConfig } from "../src/shared/mihomo";

const fixture = `
mixed-port: 7890
allow-lan: true
mode: rule
custom-option: keep-me
proxies:
  - name: HK-01
    type: vless
    server: hk.example.com
    port: 443
    uuid: 11111111-1111-4111-8111-111111111111
    tls: true
    network: ws
    ws-opts:
      path: /edge
      max-early-data: 2048
      headers:
        Host: cdn.example.com
        X-Test: preserved
    client-fingerprint: chrome
proxy-groups:
  - name: Proxy
    type: select
    proxies: [HK-01, DIRECT]
rules:
  - DOMAIN-SUFFIX,example.com,Proxy
  - MATCH,Proxy
`;

test("导入和导出 Mihomo 配置", () => {
  const config = parseMihomoYaml(fixture);
  assert.equal(config.proxies[0].wsPath, "/edge");
  assert.equal(config.proxies[0].wsHost, "cdn.example.com");
  assert.equal(config.rules[1].type, "MATCH");
  const output = YAML.parse(exportMihomoYaml(config));
  assert.equal(output["mixed-port"], 7890);
  assert.equal(output.proxies[0]["ws-opts"].headers.Host, "cdn.example.com");
});

test("往返转换保留未知字段", () => {
  const output = YAML.parse(exportMihomoYaml(parseMihomoYaml(fixture)));
  assert.equal(output["custom-option"], "keep-me");
  assert.equal(output.proxies[0]["client-fingerprint"], "chrome");
  assert.equal(output.proxies[0]["ws-opts"]["max-early-data"], 2048);
  assert.equal(output.proxies[0]["ws-opts"].headers["X-Test"], "preserved");
});

test("导出时忽略禁用规则", () => {
  const config = parseMihomoYaml(fixture);
  config.rules[0].enabled = false;
  config.rules[0].target = "Missing";
  assert.equal(validateConfig(config).some((issue) => issue.message.includes("Missing")), false);
  const output = YAML.parse(exportMihomoYaml(config));
  assert.deepEqual(output.rules, ["MATCH,Proxy"]);
});

test("校验缺失引用和循环引用", () => {
  const config = parseMihomoYaml(fixture);
  config.proxyGroups.push({ id: crypto.randomUUID(), name: "Cycle-A", type: "select", proxies: ["Cycle-B"], extra: {} });
  config.proxyGroups.push({ id: crypto.randomUUID(), name: "Cycle-B", type: "select", proxies: ["Cycle-A"], extra: {} });
  config.rules.push({ id: crypto.randomUUID(), type: "DOMAIN", value: "bad.example", target: "Missing", options: [], enabled: true });
  const issues = validateConfig(config);
  assert.ok(issues.some((issue) => issue.message.includes("循环引用")));
  assert.ok(issues.some((issue) => issue.message.includes("不存在的策略")));
});

test("限制 YAML alias 展开", () => {
  const aliases = Array.from({ length: 60 }, () => "*a").join(", ");
  assert.throws(() => parseMihomoYaml(`base: &a [1]\nitems: [${aliases}]`));
});
