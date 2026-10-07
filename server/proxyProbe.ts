import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import { kernelBinary } from "./kernelValidator";
import { resolveNodeAddresses } from "./nodeProbe";
import { isPublicAddress } from "./safeFetch";
import { exportMihomoYaml } from "../src/shared/mihomo";
import { createEmptyConfig, type ProxyNode } from "../src/shared/types";

let active = 0;

export function isolatedProbeConfig(node: ProxyNode, address: string, port: number, password: string) {
  if (!isPublicAddress(address)) throw new Error("仅允许检测公网节点");
  if (!["ss", "ssr", "vmess", "vless", "trojan", "hysteria2", "tuic", "socks5", "http", "snell"].includes(node.type)) throw new Error("该协议暂不支持代理实测");
  const config = createEmptyConfig();
  config.proxies = [{ ...node, name: "probe", server: address, sni: node.sni || (net.isIP(node.server) ? undefined : node.server) }];
  const raw = (YAML.parse(exportMihomoYaml(config)) as { proxies: Record<string, unknown>[] }).proxies[0];
  const allowed = new Set(["name", "type", "server", "port", "uuid", "password", "cipher", "username", "udp", "tls", "skip-cert-verify", "servername", "sni", "network", "ws-opts", "grpc-opts", "reality-opts", "client-fingerprint", "fingerprint", "flow", "alpn", "alterId", "obfs", "obfs-password", "congestion-controller", "udp-relay-mode", "reduce-rtt", "version", "obfs-opts", "protocol", "protocol-param", "obfs-param"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`节点参数 ${key} 不适用于隔离检测，请保留客户端测试`);
  return { "mixed-port": port, "bind-address": "127.0.0.1", "allow-lan": false, authentication: [`probe:${password}`], mode: "rule", "log-level": "silent", ipv6: true, dns: { enable: false }, proxies: [{ ...raw, name: "probe", server: address, port: node.port }], "proxy-groups": [], rules: ["IP-CIDR,1.1.1.1/32,probe,no-resolve", "MATCH,REJECT"] };
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export function readTrace(body: string) {
  const ip = body.match(/^ip=(.+)$/m)?.[1]?.trim();
  const countryCode = body.match(/^loc=([A-Z]{2})$/m)?.[1];
  if (!ip || !isPublicAddress(ip)) throw new Error("检测服务没有返回有效公网出口 IP");
  return { exitIp: ip, countryCode };
}

async function traceThroughProxy(port: number, password: string, signal: AbortSignal) {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: "1.1.1.1:443", headers: { "Proxy-Authorization": `Basic ${Buffer.from(`probe:${password}`).toString("base64")}` }, signal });
    request.on("connect", (response, connection, head) => { if (response.statusCode !== 200) { connection.destroy(); reject(new Error("节点无法建立代理隧道")); return; } if (head.length) connection.unshift(head); resolve(connection); });
    request.on("error", reject);
    request.end();
  });
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = () => tls.connect({ socket, servername: "one.one.one.one", rejectUnauthorized: true });
  try {
    return await new Promise<ReturnType<typeof readTrace>>((resolve, reject) => {
      const request = https.get({ hostname: "one.one.one.one", path: "/cdn-cgi/trace", agent, signal, headers: { Connection: "close", "Accept-Encoding": "identity" } }, (response) => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`检测服务返回 HTTP ${response.statusCode}`)); return; }
        let body = "";
        response.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); if (body.length > 32768) request.destroy(new Error("检测响应过大")); });
        response.on("error", reject);
        response.on("end", () => { try { resolve(readTrace(body)); } catch (error) { reject(error); } });
      });
      request.on("error", reject);
    });
  } finally { agent.destroy(); socket.destroy(); }
}

export async function probeProxy(node: ProxyNode) {
  if (active >= 2) throw new Error("已有两项代理实测正在运行，请稍后再试");
  active += 1;
  let directory: string | undefined;
  try {
    const binary = await kernelBinary("mihomo");
    if (!binary) throw new Error("当前部署未安装 Mihomo 内核，请通过新版安装镜像启用代理实测");
    const addresses = await resolveNodeAddresses(node.server);
    const port = await freePort();
    const password = randomBytes(24).toString("hex");
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "ou-yaml-probe-"));
    const filename = path.join(directory, "config.yaml");
    await fs.writeFile(filename, YAML.stringify(isolatedProbeConfig(node, addresses[0].address, port, password)), { mode: 0o600 });
    const child = spawn(binary, ["-d", directory, "-f", filename], { cwd: directory, stdio: "ignore", env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: directory } });
    let processError = "";
    child.once("error", () => { processError = "无法启动代理检测内核"; });
    const controller = new AbortController();
    const deadline = setTimeout(() => { controller.abort(); child.kill("SIGKILL"); }, 20_000);
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (processError || child.exitCode !== null || child.signalCode) throw new Error(processError || "内核无法加载该节点，请检查协议参数");
        const ready = await new Promise<boolean>((resolve) => { const connection = net.connect(port, "127.0.0.1"); connection.once("connect", () => { connection.destroy(); resolve(true); }); connection.once("error", () => { connection.destroy(); resolve(false); }); });
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const started = performance.now();
      const result = await traceThroughProxy(port, password, controller.signal);
      return { reachable: true, latencyMs: Math.round(performance.now() - started), resolvedAddress: addresses[0].address, ...result, checkedAt: new Date().toISOString() };
    } catch (error) { throw new Error(controller.signal.aborted ? "代理实测超时，请检查节点鉴权、UDP 支持或服务器网络" : (error as Error).message); }
    finally {
      clearTimeout(deadline);
      if (child.exitCode === null && !child.signalCode && !processError) {
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGKILL");
        await exited;
      }
    }
  } finally {
    active -= 1;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
