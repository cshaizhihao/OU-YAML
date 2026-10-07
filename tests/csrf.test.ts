import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedMutationOrigin } from "../server/csrf";

function request(headers: Record<string, string> = {}) {
  return {
    method: "POST",
    path: "/api/projects",
    protocol: "https",
    get(name: string) { return headers[name.toLowerCase()]; },
  } as any;
}

test("Origin 防护允许同源和配置的公开域名", () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://panel.example.com/";
  try {
    assert.equal(isAllowedMutationOrigin(request({ origin: "https://panel.example.com" })), true);
    assert.equal(isAllowedMutationOrigin(request({ origin: "https://other.example.com" })), false);
    assert.equal(isAllowedMutationOrigin({ ...request({ origin: "https://panel.example.com" }), method: "GET" }), true);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test("无 Origin 的命令行请求保持可用，但浏览器跨站请求被拒绝", () => {
  assert.equal(isAllowedMutationOrigin(request()), true);
  assert.equal(isAllowedMutationOrigin(request({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(isAllowedMutationOrigin(request({ "sec-fetch-site": "same-origin" })), true);
});
