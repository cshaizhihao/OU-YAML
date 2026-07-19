export type ProxyType = "ss" | "vmess" | "vless" | "trojan" | "snell" | "socks5" | "http" | "hysteria2" | "tuic" | "wireguard";

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
