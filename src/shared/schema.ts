import { z } from "zod";

const identifier = z.string().trim().min(1).max(200);
const optionalText = (limit: number) => z.string().max(limit).optional();

export const proxyNodeSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(40),
  server: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  udp: z.boolean().optional(),
  tls: z.boolean().optional(),
  skipCertVerify: z.boolean().optional(),
  sni: optionalText(512),
  uuid: optionalText(512),
  password: optionalText(4096),
  cipher: optionalText(256),
  network: optionalText(64),
  wsPath: optionalText(2048),
  wsHost: optionalText(512),
  grpcServiceName: optionalText(512),
  extra: z.record(z.unknown()).default({}),
  formatExtra: z.object({ singBox: z.record(z.unknown()).optional() }).optional(),
  source: z.object({ kind: z.literal("subscription"), id: identifier }).optional(),
}).passthrough();

export const proxyGroupSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(200),
  type: z.enum(["select", "url-test", "fallback", "load-balance", "relay"]),
  proxies: z.array(z.string().trim().min(1).max(200)).max(5000),
  url: optionalText(2048),
  interval: z.number().int().min(1).max(86400).optional(),
  tolerance: z.number().int().min(0).max(60000).optional(),
  lazy: z.boolean().optional(),
  extra: z.record(z.unknown()).default({}),
  formatExtra: z.object({ singBox: z.record(z.unknown()).optional() }).optional(),
}).passthrough();

export const ruleItemSchema = z.object({
  id: identifier,
  type: z.string().trim().min(1).max(64),
  value: z.string().max(4096),
  target: z.string().trim().min(1).max(200),
  options: z.array(z.string().max(2048)).max(100),
  enabled: z.boolean(),
  comment: z.string().max(500).optional(),
  formatExtra: z.object({ singBox: z.record(z.unknown()).optional() }).optional(),
}).passthrough();

export const mihomoConfigSchema = z.object({
  version: z.literal(1),
  mixedPort: z.number().int().min(1).max(65535),
  allowLan: z.boolean(),
  mode: z.enum(["rule", "global", "direct"]),
  logLevel: z.enum(["silent", "error", "warning", "info", "debug"]),
  ipv6: z.boolean(),
  externalController: z.string().max(512),
  proxies: z.array(proxyNodeSchema).max(5000),
  proxyGroups: z.array(proxyGroupSchema).max(1000),
  rules: z.array(ruleItemSchema).max(10000),
  extra: z.record(z.unknown()).default({}),
  metadata: z.object({ singBox: z.record(z.unknown()).optional() }).optional(),
}).passthrough();

export function readMihomoConfig(value: unknown) {
  return mihomoConfigSchema.safeParse(value);
}
