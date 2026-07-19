export type ProxyType = "ss" | "ssr" | "vmess" | "vless" | "trojan" | "snell" | "socks5" | "http" | "hysteria2" | "tuic" | "wireguard";
export type TargetFormat = "mihomo" | "sing-box";

export interface SessionUser {
  username: string;
  isAdmin: boolean;
}

export interface UserAccount extends SessionUser {
  id: string;
  disabled: boolean;
  projectCount: number;
  createdAt: string;
}

export interface KernelValidationResult {
  available: boolean;
  valid?: boolean;
  engine: TargetFormat;
  output: string;
}

export interface ProxyNode {
  id: string;
  name: string;
  type: ProxyType | string;
  server: string;
  port: number;
  udp?: boolean;
  tls?: boolean;
  skipCertVerify?: boolean;
  sni?: string;
  uuid?: string;
  password?: string;
  cipher?: string;
  network?: string;
  wsPath?: string;
  wsHost?: string;
  grpcServiceName?: string;
  extra: Record<string, unknown>;
  formatExtra?: { singBox?: Record<string, unknown> };
  source?: { kind: "subscription"; id: string };
}

export type GroupType = "select" | "url-test" | "fallback" | "load-balance" | "relay";

export interface ProxyGroup {
  id: string;
  name: string;
  type: GroupType;
  proxies: string[];
  url?: string;
  interval?: number;
  tolerance?: number;
  lazy?: boolean;
  extra: Record<string, unknown>;
  formatExtra?: { singBox?: Record<string, unknown> };
}

export interface RuleItem {
  id: string;
  type: string;
  value: string;
  target: string;
  options: string[];
  enabled: boolean;
  comment?: string;
}

export interface MihomoConfig {
  version: 1;
  mixedPort: number;
  allowLan: boolean;
  mode: "rule" | "global" | "direct";
  logLevel: "silent" | "error" | "warning" | "info" | "debug";
  ipv6: boolean;
  externalController: string;
  proxies: ProxyNode[];
  proxyGroups: ProxyGroup[];
  rules: RuleItem[];
  extra: Record<string, unknown>;
  metadata?: { singBox?: Record<string, unknown> };
}

export interface ValidationIssue {
  level: "error" | "warning";
  scope: "config" | "proxy" | "group" | "rule";
  id?: string;
  message: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  config: MihomoConfig;
  targetFormat: TargetFormat;
}

export interface Subscription {
  id: string;
  projectId: string;
  name: string;
  url: string;
  format: "auto" | "links" | "mihomo" | "sing-box";
  intervalMinutes: number;
  lastUpdatedAt?: string;
  lastError?: string;
  nodeCount: number;
  createdAt: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  label: string;
  targetFormat: TargetFormat;
  proxyCount: number;
  groupCount: number;
  ruleCount: number;
  createdAt: string;
}

export const createEmptyConfig = (): MihomoConfig => ({
  version: 1,
  mixedPort: 7890,
  allowLan: false,
  mode: "rule",
  logLevel: "info",
  ipv6: false,
  externalController: "127.0.0.1:9090",
  proxies: [],
  proxyGroups: [
    {
      id: crypto.randomUUID(),
      name: "节点选择",
      type: "select",
      proxies: ["DIRECT"],
      extra: {},
    },
  ],
  rules: [
    {
      id: crypto.randomUUID(),
      type: "MATCH",
      value: "",
      target: "节点选择",
      options: [],
      enabled: true,
    },
  ],
  extra: {},
});
