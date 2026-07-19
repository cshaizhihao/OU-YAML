import assert from "node:assert/strict";
import { test } from "node:test";
import { exportSingBoxJson, parseSingBoxJson } from "../src/shared/singbox";

const fixture = JSON.stringify({
  log: { level: "info", timestamp: true },
  dns: { servers: [{ tag: "local", address: "local" }] },
  inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],
  outbounds: [
    { type: "vless", tag: "HK-01", server: "hk.example.com", server_port: 443, uuid: "uuid", flow: "xtls-rprx-vision", tls: { enabled: true, server_name: "cdn.example.com" }, transport: { type: "ws", path: "/edge", headers: { Host: "cdn.example.com" } } },
    { type: "selector", tag: "Proxy", outbounds: ["HK-01", "direct"] },
    { type: "direct", tag: "direct" },
  ],
  route: { auto_detect_interface: true, rules: [{ domain_suffix: ["example.com"], outbound: "Proxy" }], final: "Proxy" },
});

test("导入 sing-box 节点、策略组和路由", () => {
  const config = parseSingBoxJson(fixture);
  assert.equal(config.mixedPort, 2080);
  assert.equal(config.proxies[0].type, "vless");
  assert.equal(config.proxies[0].wsPath, "/edge");
  assert.equal(config.proxyGroups[0].name, "Proxy");
  assert.deepEqual(config.proxyGroups[0].proxies, ["HK-01", "DIRECT"]);
  assert.equal(config.rules.at(-1)?.type, "MATCH");
});

test("sing-box 往返保留格式专属字段", () => {
  const output = JSON.parse(exportSingBoxJson(parseSingBoxJson(fixture)));
  assert.equal(output.dns.servers[0].tag, "local");
  assert.equal(output.log.timestamp, true);
  assert.equal(output.outbounds[0].flow, "xtls-rprx-vision");
  assert.equal(output.route.auto_detect_interface, true);
  assert.equal(output.route.final, "Proxy");
});
