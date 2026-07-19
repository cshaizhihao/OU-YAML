import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShareLink, parseShareLinks } from "../src/shared/links";

const base64 = (value: string) => Buffer.from(value).toString("base64url");

test("解析 SS SIP002 链接", () => {
  const node = parseShareLink(`ss://${base64("aes-128-gcm:secret")}@ss.example.com:8388#Tokyo`);
  assert.equal(node.type, "ss");
  assert.equal(node.cipher, "aes-128-gcm");
  assert.equal(node.password, "secret");
  assert.equal(node.port, 8388);
});

test("解析 VMess 和 VLESS 链接", () => {
  const vmess = parseShareLink(`vmess://${base64(JSON.stringify({ ps: "VMess HK", add: "hk.example.com", port: 443, id: "uuid-1", net: "ws", tls: "tls", host: "cdn.example.com", path: "/edge" }))}`);
  const vless = parseShareLink("vless://uuid-2@us.example.com:8443?security=tls&type=grpc&serviceName=edge&sni=cdn.example.com#VLESS-US");
  assert.equal(vmess.wsHost, "cdn.example.com");
  assert.equal(vless.type, "vless");
  assert.equal(vless.grpcServiceName, "edge");
  assert.equal(vless.tls, true);
});

test("解析 Trojan、Hysteria2、TUIC、Snell 和 Socks", () => {
  const inputs = [
    "trojan://pass@a.example.com:443#Trojan",
    "hysteria2://pass@b.example.com:443?sni=b.example.com#HY2",
    "tuic://uuid:pass@c.example.com:443#TUIC",
    "snell://psk@d.example.com:443#Snell",
    "socks5://user:pass@e.example.com:1080#Socks",
  ];
  assert.deepEqual(inputs.map((input) => parseShareLink(input).type), ["trojan", "hysteria2", "tuic", "snell", "socks5"]);
});

test("解析整段 Base64 订阅并报告坏行", () => {
  const source = base64(`vless://uuid@one.example.com:443#One\ninvalid-line\ntrojan://pass@two.example.com:443#Two`);
  const result = parseShareLinks(source);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});
