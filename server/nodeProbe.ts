import dns from "node:dns/promises";
import net from "node:net";
import { isPublicAddress } from "./safeFetch";

export type ResolvedAddress = { address: string; family: number };
export type TcpPingResult = {
  reachable: boolean;
  latencyMs: number | null;
  resolvedAddress: string | null;
  error?: string;
};
export type CountryLookupResult = {
  ip: string;
  countryCode: string;
  country: string;
  flag: string;
};

type Lookup = (hostname: string) => Promise<ResolvedAddress[]>;
type Connector = (address: ResolvedAddress, port: number, timeoutMs: number) => Promise<number>;
type Fetcher = typeof fetch;
const countryCache = new Map<string, { value: CountryLookupResult; expiresAt: number }>();

function normalizeHostname(input: string) {
  return input.trim().replace(/^\[|\]$/g, "");
}

export function filterPublicNodeAddresses(records: readonly ResolvedAddress[]) {
  if (!records.length) throw new Error("节点服务器没有解析到 IP 地址");
  if (records.some((record) => !isPublicAddress(record.address))) throw new Error("为保护服务器安全，不能检测本机或局域网地址");
  return records
    .filter((record, index) => records.findIndex((item) => item.address === record.address && item.family === record.family) === index)
    .sort((left, right) => Number(right.family === 4) - Number(left.family === 4))
    .slice(0, 8);
}

export async function resolveNodeAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalized.length > 253) throw new Error("节点服务器地址无效");
  if (["localhost", "localhost.localdomain"].includes(normalized.toLowerCase()) || normalized.toLowerCase().endsWith(".local")) throw new Error("为保护服务器安全，不能检测本机或局域网地址");
  const family = net.isIP(normalized);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const records = family ? [{ address: normalized, family }] : await Promise.race([
    dns.lookup(normalized, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("节点域名解析超时")), 5000); }),
  ]).finally(() => clearTimeout(timer));
  return filterPublicNodeAddresses(records);
}

const defaultLookup = resolveNodeAddresses;

function defaultConnect(address: ResolvedAddress, port: number, timeoutMs: number) {
  return new Promise<number>((resolve, reject) => {
    const startedAt = performance.now();
    const socket = net.createConnection({ host: address.address, port, family: address.family });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(Math.max(1, Math.round(performance.now() - startedAt)));
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(new Error("连接超时")));
    socket.once("error", (error) => finish(error));
  });
}

function nodeErrorMessage(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ECONNREFUSED") return "端口拒绝连接";
  if (code === "ETIMEDOUT" || (error instanceof Error && error.message === "连接超时")) return "连接超时";
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH") return "网络不可达";
  return error instanceof Error ? error.message : "TCP 连接失败";
}

export async function tcpPingNode(server: string, port: number, options: { timeoutMs?: number; lookup?: Lookup; connect?: Connector } = {}): Promise<TcpPingResult> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("节点端口无效");
  const addresses = await (options.lookup || defaultLookup)(normalizeHostname(server));
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 5000, 500), 10_000);
  let lastError: unknown;
  for (const address of addresses) {
    try {
      const latencyMs = await (options.connect || defaultConnect)(address, port, timeoutMs);
      return { reachable: true, latencyMs, resolvedAddress: address.address };
    } catch (error) {
      lastError = error;
    }
  }
  return { reachable: false, latencyMs: null, resolvedAddress: addresses[0]?.address || null, error: nodeErrorMessage(lastError) };
}

export function countryCodeToFlag(countryCode: string) {
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new Error("国家或地区代码无效");
  return [...normalized].map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65)).join("");
}

export function addCountryFlag(name: string, flag: string) {
  const cleanName = name.replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}[\s·|｜-]*)+/u, "").trim() || "节点";
  const prefix = `${flag} `;
  return `${prefix}${cleanName.slice(0, Math.max(1, 160 - prefix.length))}`;
}

async function fetchCountry(address: string, fetcher: Fetcher) {
  const services = [
    {
      url: `https://ipwho.is/${encodeURIComponent(address)}?fields=success,country_code,country,ip,message`,
      parse: (value: Record<string, unknown>) => value.success === false ? undefined : { countryCode: String(value.country_code || ""), country: String(value.country || "") },
    },
    {
      url: `https://api.country.is/${encodeURIComponent(address)}`,
      parse: (value: Record<string, unknown>) => ({ countryCode: String(value.country || ""), country: String(value.country || "") }),
    },
  ];
  let lastError: unknown;
  for (const service of services) {
    try {
      const response = await fetcher(service.url, { headers: { Accept: "application/json", "User-Agent": "OU-YAML/1.7" }, signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > 20_000) throw new Error("归属地服务响应过大");
      const result = service.parse(JSON.parse(body) as Record<string, unknown>);
      if (result && /^[A-Za-z]{2}$/.test(result.countryCode)) return result;
      throw new Error("归属地服务没有返回国家代码");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法查询服务器 IP 归属地：${lastError instanceof Error ? lastError.message : "服务不可用"}`);
}

export async function lookupNodeCountry(server: string, options: { lookup?: Lookup; fetcher?: Fetcher } = {}): Promise<CountryLookupResult> {
  const addresses = await (options.lookup || defaultLookup)(normalizeHostname(server));
  const ip = addresses[0].address;
  const cached = !options.lookup && !options.fetcher ? countryCache.get(ip) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await fetchCountry(ip, options.fetcher || fetch);
  const countryCode = result.countryCode.toUpperCase();
  const value = { ip, countryCode, country: result.country || countryCode, flag: countryCodeToFlag(countryCode) };
  if (!options.lookup && !options.fetcher) {
    if (countryCache.size >= 2000) countryCache.delete(countryCache.keys().next().value!);
    countryCache.set(ip, { value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  }
  return value;
}
