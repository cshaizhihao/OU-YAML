import assert from "node:assert/strict";
import test from "node:test";
import { isolatedProbeConfig, readTrace } from "../server/proxyProbe";
import { diagnosticAdvice } from "../server/sourceDiagnostics";

const node = { id: "test", name: "测试", type: "vless", server: "edge.example.com", port: 443, uuid: "test", tls: true, extra: {} };
test("代理实测固定公网节点地址、回环监听与鉴权并拒绝危险参数", () => {
  const config = isolatedProbeConfig(node, "1.1.1.1", 23456, "secret");
  assert.equal(config["bind-address"], "127.0.0.1");
  assert.deepEqual(config.authentication, ["probe:secret"]);
  assert.equal(config.proxies[0].server, "1.1.1.1");
  assert.deepEqual(config.rules, ["IP-CIDR,1.1.1.1/32,probe,no-resolve", "MATCH,REJECT"]);
  assert.throws(() => isolatedProbeConfig(node, "127.0.0.1", 23456, "secret"), /公网/);
  assert.throws(() => isolatedProbeConfig({ ...node, extra: { "dialer-proxy": "DIRECT" } }, "1.1.1.1", 23456, "secret"), /不适用于隔离检测/);
});
test("出口读取拒绝伪造或非公网结果，诊断不返回订阅密钥", () => {
  assert.equal(readTrace("ip=8.8.8.8\nloc=US\n").exitIp, "8.8.8.8");
  assert.throws(() => readTrace("ip=127.0.0.1\nloc=US\n"), /公网/);
  const advice = diagnosticAdvice(new Error("404 https://airport.example/private-token?token=secret"));
  assert.match(advice, /404/);
  assert.doesNotMatch(advice, /secret|private-token/);
});
