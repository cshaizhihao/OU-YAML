import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShareLink, parseShareLinks, serializeShareLink } from "../src/shared/links";

const base64 = (value: string) => Buffer.from(value).toString("base64url");

test("SSR 使用标准七段主体并保留混淆参数", () => {
  const input = `ssr://${base64(`ssr.example.com:443:origin:aes-128-gcm:plain:${base64("cdn.example.com")}:${base64("secret")}/?remarks=${base64("SSR 标准链接")}&obfsparam=${base64("cdn.example.com")}`)}`;
  const node = parseShareLink(input);
  assert.equal(node.password, "secret");
  assert.equal(node.extra["obfs-param"], "cdn.example.com");
  const output = serializeShareLink(node);
  assert.ok(output);
  const fields = Buffer.from(output.slice(6), "base64url").toString().split("/?")[0].split(":");
  assert.equal(fields.length, 7);
  assert.equal(Buffer.from(fields[5], "base64").toString(), "cdn.example.com");
  assert.equal(Buffer.from(fields[6], "base64").toString(), "secret");
});

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

test("链接协议大小写和 Hysteria 别名可以识别", () => {
  assert.equal(parseShareLink("VLESS://uuid@edge.example.com:443#Edge").type, "vless");
  assert.equal(parseShareLink("hysteria://pass@edge.example.com:443#Hysteria").type, "hysteria2");
  assert.equal(parseShareLink("hy2://pass@[2001:db8::1]:443#IPv6").server, "2001:db8::1");
});

test("复制协议链接可以往返解析并保留凭据字段", () => {
  const vless = {
    id: "vless-1",
    name: "VLESS 测试",
    type: "vless",
    server: "edge.example.com",
    port: 443,
    uuid: "uuid@example/1",
    tls: true,
    sni: "cdn.example.com",
    network: "ws",
    wsPath: "/edge",
    extra: {},
  };
  const ssr = {
    id: "ssr-1",
    name: "SSR 测试",
    type: "ssr",
    server: "ssr.example.com",
    port: 443,
    cipher: "aes-128-gcm",
    password: "secret",
    extra: { protocol: "auth_aes128_md5", obfs: "tls1.2_ticket_auth", "obfs-param": "cdn.example.com" },
  };
  const vlessLink = serializeShareLink(vless);
  const ssrLink = serializeShareLink(ssr);
  assert.ok(vlessLink);
  assert.ok(ssrLink);
  assert.equal(parseShareLink(vlessLink).uuid, vless.uuid);
  assert.equal(parseShareLink(vlessLink).wsPath, vless.wsPath);
  assert.equal(parseShareLink(ssrLink).password, ssr.password);
  assert.equal(parseShareLink(ssrLink).extra["obfs-param"], "cdn.example.com");
  assert.equal(serializeShareLink({ ...vless, type: "wireguard" }), null);
});
