import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { diagnoseSource } from "../server/sourceDiagnostics";

test("真实 HTTP 兼容重试、HTML 诊断、重定向 SSRF 与路径令牌脱敏", async (context) => {
  let mode = "retry";
  const agents: string[] = [];
  const server = http.createServer((request, response) => {
    agents.push(String(request.headers["user-agent"]));
    if (mode === "redirect") { response.writeHead(302, { Location: "http://127.0.0.1/private-secret" }).end(); return; }
    if (mode === "html") { response.writeHead(200, { "Content-Type": "text/html" }).end("<html>login token=private-secret</html>"); return; }
    if (mode === "404" || agents.length === 1) { response.writeHead(404).end("private-secret"); return; }
    response.end("vless://dba693d3-d530-4235-bf30-cb9c30d89481@1.1.1.1:443#test");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const original = http.request;
  context.mock.method(http, "request", (options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    assert.equal(options.hostname, "1.1.1.1");
    return original({ ...options, hostname: "127.0.0.1", port }, callback);
  });
  const source = { url: "http://1.1.1.1/private-secret?token=private-secret", format: "auto" };
  try {
    const success = await diagnoseSource(source);
    assert.equal(success.ok, true);
    assert.equal(success.nodeCount, 1);
    assert.equal(agents.length, 2);
    assert.ok(success.events.some((event) => event.status === 404));
    for (mode of ["html", "404", "redirect"]) {
      const result = await diagnoseSource(source);
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /private-secret/);
      if (mode === "html") assert.match(result.advice, /网页/);
      if (mode === "404") assert.match(result.advice, /404/);
      if (mode === "redirect") assert.match(result.advice, /局域网/);
    }
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
