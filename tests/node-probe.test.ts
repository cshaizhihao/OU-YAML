import assert from "node:assert/strict";
import { test } from "node:test";
import { addCountryFlag, countryCodeToFlag, filterPublicNodeAddresses, lookupNodeCountry, tcpPingNode } from "../server/nodeProbe";

test("国家代码转换为国旗并替换已有名称前缀", () => {
  assert.equal(countryCodeToFlag("hk"), "🇭🇰");
  assert.equal(addCountryFlag("香港节点", "🇭🇰"), "🇭🇰 香港节点");
  assert.equal(addCountryFlag("🇯🇵 · 东京节点", "🇸🇬"), "🇸🇬 东京节点");
});

test("节点检测拒绝本机和局域网地址", () => {
  assert.throws(() => filterPublicNodeAddresses([{ address: "127.0.0.1", family: 4 }]), /本机或局域网/);
  assert.throws(() => filterPublicNodeAddresses([{ address: "192.168.1.10", family: 4 }]), /本机或局域网/);
  assert.deepEqual(filterPublicNodeAddresses([{ address: "2001:4860:4860::8888", family: 6 }, { address: "8.8.8.8", family: 4 }]), [{ address: "8.8.8.8", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }]);
});

test("TCP Ping 返回真实握手结果并按地址回退", async () => {
  const attempted: string[] = [];
  const result = await tcpPingNode("edge.example.com", 443, {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "1.1.1.1", family: 4 }],
    connect: async (address) => {
      attempted.push(address.address);
      if (address.address === "8.8.8.8") throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      return 36;
    },
  });
  assert.deepEqual(attempted, ["8.8.8.8", "1.1.1.1"]);
  assert.deepEqual(result, { reachable: true, latencyMs: 36, resolvedAddress: "1.1.1.1" });
});

test("IP 归属地结果生成国旗", async () => {
  const result = await lookupNodeCountry("edge.example.com", {
    lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    fetcher: async () => new Response(JSON.stringify({ success: true, country_code: "AU", country: "Australia", ip: "1.1.1.1" }), { status: 200 }),
  });
  assert.deepEqual(result, { ip: "1.1.1.1", countryCode: "AU", country: "Australia", flag: "🇦🇺" });
});

test("国旗改名幂等、保留自定义别名正文并限制名称长度", () => {
  assert.equal(addCountryFlag("🇯🇵 · 专属线路", "🇸🇬"), "🇸🇬 专属线路");
  assert.equal(addCountryFlag("🇸🇬 专属线路", "🇸🇬"), "🇸🇬 专属线路");
  assert.equal(addCountryFlag("x".repeat(200), "🇺🇸").length, 160);
  assert.throws(() => addCountryFlag("线路", "US"), /国旗无效/);
});

test("IP 归属地解析或查询失败时不会返回可应用的结果", async () => {
  await assert.rejects(lookupNodeCountry("edge.example.com", {
    lookup: async () => [],
    fetcher: async () => { throw new Error("不应发起 HTTP 请求"); },
  }), /没有解析到 IP/);
  await assert.rejects(lookupNodeCountry("edge.example.com", {
    lookup: async () => [{ address: "1.1.1.1", family: 4 }],
    fetcher: async () => new Response(JSON.stringify({ success: false, message: "lookup failed" }), { status: 200 }),
  }), /无法查询服务器 IP 归属地/);
});
