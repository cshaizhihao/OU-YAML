import type { NodeSource, ManagedNode, GenerationProfile, GeneratedSubscription } from "./shared/domain";
import type { QuickPublishInput, QuickPublishPreview } from "./shared/publication";
import type { SubscriptionEditInput, SubscriptionEditorState } from "./shared/subscriptionEditor";
import type { KernelInfo, KernelValidationResult, MihomoConfig, Project, ProjectSummary, ProjectVersion, SessionUser, Subscription, TargetFormat, UserAccount, ValidationIssue } from "./shared/types";
import { z } from "zod";


export type UpdateInfo = { currentVersion: string; latestVersion: string | null; currentCommit: string | null; latestCommit: string | null; updateKind: "version" | "build" | null; hasUpdate: boolean; releaseUrl: string | null; releaseNotes: string; publishedAt: string | null; agentAvailable: boolean };
export type UpdateStatus = { status: "idle" | "requested" | "running" | "completed" | "failed"; message: string; progress: number; updatedAt: string | null };
export type TcpPingResult = { reachable: boolean; latencyMs: number | null; resolvedAddress: string | null; error?: string };
export type ProxyProbeResult = TcpPingResult & { exitIp: string; countryCode?: string; checkedAt: string };
export type NodeCountryResult = { node: ManagedNode; location: { ip: string; countryCode: string; country: string; flag: string } };
export type ImportPreview = { config?: MihomoConfig; nodes: MihomoConfig["proxies"]; format: TargetFormat | "links"; warnings: string[]; issues: ValidationIssue[]; requestProfile?: string };

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly url: string, public readonly kind: "http" | "network" | "invalid-response", public readonly issues?: ValidationIssue[]) {
    super(message);
    this.name = "ApiError";
  }
}

const validationIssuesSchema = z.array(z.object({
  level: z.enum(["error", "warning"]), scope: z.enum(["config", "proxy", "group", "rule"]), id: z.string().optional(), message: z.string(),
}));
const subscriptionEditorSchema = z.object({
  subscription: z.object({ id: z.string().min(1), name: z.string() }).passthrough(),
  config: z.object({
    proxies: z.array(z.object({ id: z.string() }).passthrough()),
    proxyGroups: z.array(z.unknown()),
    rules: z.array(z.unknown()),
  }).passthrough(),
  revision: z.string().min(1),
}).passthrough();
const managedNodesSchema = z.array(z.object({
  id: z.string(), name: z.string(), type: z.string(), server: z.string(), port: z.number(), enabled: z.boolean(),
}).passthrough());

function isJson(response: Response) {
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() || "";
  return contentType === "application/json" || /^application\/[\w.+-]+\+json$/.test(contentType);
}

function invalidResponse(response: Response, url: string, detail: string) {
  return new ApiError(`接口返回${detail}（HTTP ${response.status}）。请刷新页面重试；若持续出现，请检查服务端与反向代理配置。`, response.status, url, "invalid-response");
}

async function fetchResponse(url: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!(options?.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(url, { ...options, headers }); }
  catch { throw new ApiError("无法连接服务器，请检查网络后重试。", 0, url, "network"); }
  if (!response.ok) {
    const body: unknown = isJson(response) ? await response.json().catch(() => undefined) : undefined;
    const envelope = z.object({ error: z.unknown().optional(), issues: z.unknown().optional() }).safeParse(body);
    const message = envelope.success && typeof envelope.data.error === "string" && envelope.data.error.trim() ? envelope.data.error : `请求失败（HTTP ${response.status}）。请稍后重试；若持续出现，请检查服务端与反向代理配置。`;
    const issues = validationIssuesSchema.safeParse(envelope.success ? envelope.data.issues : undefined);
    throw new ApiError(message, response.status, url, "http", issues.success ? issues.data : undefined);
  }
  return response;
}

function isExportContent(response: Response) {
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() || "";
  return isJson(response) || ["application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml", "text/plain"].includes(contentType);
}

async function request<T>(url: string, options?: RequestInit, schema?: z.ZodType<unknown>): Promise<T> {
  const response = await fetchResponse(url, options);
  if (response.status === 204 && !schema) return undefined as T;
  if (!isJson(response)) throw invalidResponse(response, url, "了非 JSON 内容");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw invalidResponse(response, url, "的 JSON 无法解析"); }
  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw invalidResponse(response, url, "的数据格式不符合预期");
    return parsed.data as T;
  }
  if (!body || typeof body !== "object") throw invalidResponse(response, url, "的数据格式不符合预期");
  return body as T;
}

export const api = {
  previewImport: (content: string, remote = false, format: "auto" | "links" | TargetFormat = "auto", options: { userAgent?: string; skipCertVerify?: boolean } = {}) => request<ImportPreview>("/api/tools/import-preview", { method: "POST", body: JSON.stringify({ content, remote, format, ...options }) }),
  me: () => request<{ username: string | null; isAdmin: boolean }>("/api/auth/me"),
  login: (username: string, password: string) => request<SessionUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  listUsers: () => request<UserAccount[]>("/api/admin/users"),
  createUser: (username: string, password: string, isAdmin: boolean) => request<UserAccount>("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password, isAdmin }) }),
  updateUser: (id: string, data: { isAdmin: boolean; disabled: boolean; password?: string }) => request<UserAccount>(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: string) => request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
  checkUpdate: (channel: "stable" | "preview" = "stable") => request<UpdateInfo>(`/api/admin/update/check?channel=${channel}`),
  getUpdateStatus: () => request<UpdateStatus>("/api/admin/update/status"),
  getUpdateLog: () => request<{ log: string }>("/api/admin/update/log"),
  startUpdate: (channel: "stable" | "preview" = "stable") => request<{ accepted: boolean }>("/api/admin/update/start", { method: "POST", body: JSON.stringify({ channel }) }),
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  listNodeSources: () => request<NodeSource[]>("/api/node-sources"),
  diagnoseSource: (id: string) => request<{ ok: boolean; nodeCount: number; advice: string; events: { stage: string; profile?: string; status?: number; address?: string; message: string }[] }>(`/api/node-sources/${id}/diagnose`, { method: "POST" }),
  createNodeSource: (data: Pick<NodeSource, "name" | "kind" | "format" | "enabled" | "intervalMinutes" | "skipCertVerify"> & { url?: string; userAgent?: string }) => request<NodeSource>("/api/node-sources", { method: "POST", body: JSON.stringify(data) }),
  updateNodeSource: (id: string, data: Pick<NodeSource, "name" | "kind" | "format" | "enabled" | "intervalMinutes" | "skipCertVerify"> & { url?: string; userAgent?: string }) => request<NodeSource>(`/api/node-sources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  refreshNodeSource: (id: string) => request<{ source: NodeSource; nodes: ManagedNode[]; warnings: string[] }>(`/api/node-sources/${id}/refresh`, { method: "POST" }),
  importNodeSource: (id: string, content: string) => request<{ source: NodeSource; nodes: ManagedNode[]; warnings: string[] }>(`/api/node-sources/${id}/import`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }),
  listManagedNodes: (sourceId?: string) => request<ManagedNode[]>(`/api/managed-nodes${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`, undefined, managedNodesSchema),
  createManagedNode: (data: Partial<ManagedNode> & Pick<ManagedNode, "name" | "type" | "server" | "port">) => request<ManagedNode>("/api/managed-nodes", { method: "POST", body: JSON.stringify(data) }),
  updateManagedNode: (id: string, data: Partial<ManagedNode> & Pick<ManagedNode, "name" | "type" | "server" | "port">) => request<ManagedNode>(`/api/managed-nodes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  reorderManagedNodes: (ids: string[]) => request<ManagedNode[]>("/api/managed-nodes/order", { method: "PUT", body: JSON.stringify({ ids }) }),
  batchUpdateManagedNodes: (data: { ids: string[]; enabled?: boolean; addTags?: string[]; removeTags?: string[]; prefix?: string; find?: string; replace?: string }) => request<ManagedNode[]>("/api/managed-nodes/batch", { method: "PUT", body: JSON.stringify(data) }),
  tcpPingManagedNode: (id: string) => request<TcpPingResult>(`/api/managed-nodes/${id}/tcp-ping`, { method: "POST" }),
  proxyTestManagedNode: (id: string) => request<ProxyProbeResult>(`/api/managed-nodes/${id}/proxy-test`, { method: "POST" }),
  applyManagedNodeCountryFlag: (id: string, basis: "entry" | "exit" = "entry") => request<NodeCountryResult>(`/api/managed-nodes/${id}/country-flag`, { method: "POST", body: JSON.stringify({ basis }) }),
  deleteNodeSource: (id: string) => request<{ deleted: boolean }>(`/api/node-sources/${id}`, { method: "DELETE" }),
  deleteManagedNode: (id: string) => request<{ deleted: boolean }>(`/api/managed-nodes/${id}`, { method: "DELETE" }),
  listProxyGroups: () => request<any[]>("/api/proxy-groups"),
  createProxyGroup: (data: any) => request<any>("/api/proxy-groups", { method: "POST", body: JSON.stringify(data) }),
  listRuleSets: () => request<any[]>("/api/rule-sets"),
  createRuleSet: (data: any) => request<any>("/api/rule-sets", { method: "POST", body: JSON.stringify(data) }),
  listRuleTemplates: () => request<any[]>("/api/rule-templates"),
  createRuleTemplate: (data: { name: string; description?: string; targetFormat: TargetFormat; content: unknown[] }) => request<any>("/api/rule-templates", { method: "POST", body: JSON.stringify(data) }),
  updateRuleTemplate: (id: string, data: { name: string; description?: string; targetFormat: TargetFormat; content: unknown[] }) => request<any>(`/api/rule-templates/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRuleTemplate: (id: string) => request<{ deleted: boolean }>(`/api/rule-templates/${id}`, { method: "DELETE" }),
  listGenerationProfiles: () => request<GenerationProfile[]>("/api/generation-profiles"),
  previewQuickPublish: (id: string, data: QuickPublishInput) => request<QuickPublishPreview>(`/api/projects/${id}/quick-preview`, { method: "POST", body: JSON.stringify(data) }),
  quickPublish: (id: string, data: QuickPublishInput) => request<GeneratedSubscription & { kernelChecked: boolean }>(`/api/projects/${id}/quick-publish`, { method: "POST", body: JSON.stringify(data) }),
  setProfileSync: (id: string, data: { autoUpdate: boolean; includeNewNodes: boolean }) => request<GenerationProfile>(`/api/generation-profiles/${id}/sync`, { method: "PUT", body: JSON.stringify(data) }),
  syncProfile: (id: string) => request<{ synced: boolean }>(`/api/generation-profiles/${id}/sync`, { method: "POST" }),
  getSubscriptionToken: (id: string) => request<{ token: string }>(`/api/generated-subscriptions/${id}/token`),
  createGenerationProfile: (data: Pick<GenerationProfile, "name" | "targetFormat" | "config"> & { nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) => request<GenerationProfile>("/api/generation-profiles", { method: "POST", body: JSON.stringify(data) }),
  updateGenerationProfile: (id: string, data: Pick<GenerationProfile, "name" | "targetFormat" | "config"> & { nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) => request<GenerationProfile>(`/api/generation-profiles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGenerationProfile: (id: string) => request<{ deleted: boolean }>(`/api/generation-profiles/${id}`, { method: "DELETE" }),
  listGeneratedSubscriptions: () => request<GeneratedSubscription[]>("/api/generated-subscriptions"),
  getSubscriptionEditor: (id: string) => request<SubscriptionEditorState>(`/api/generated-subscriptions/${id}/editor`, undefined, subscriptionEditorSchema.refine((editor) => editor.subscription.id === id)),
  saveSubscriptionEditor: (id: string, input: SubscriptionEditInput) => request<SubscriptionEditorState & { kernelChecked: boolean }>(`/api/generated-subscriptions/${id}/editor`, { method: "PUT", body: JSON.stringify(input) }, subscriptionEditorSchema.extend({ kernelChecked: z.boolean() }).refine((editor) => editor.subscription.id === id)),
  renameSubscription: (id: string, name: string) => request<GeneratedSubscription>(`/api/generated-subscriptions/${id}/name`, { method: "PUT", body: JSON.stringify({ name }) }),
  revokeGeneratedSubscription: (id: string) => request<{ revoked: boolean }>(`/api/generated-subscriptions/${id}/revoke`, { method: "POST" }),
  rotateGeneratedSubscriptionToken: (id: string) => request<{ token: string }>(`/api/generated-subscriptions/${id}/token`, { method: "POST" }),
  updateGeneratedSubscription: (id: string, data: { name: string; content: string; nodeCount: number; expiresAt?: string }) => request<GeneratedSubscription>(`/api/generated-subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteGeneratedSubscription: (id: string) => request<{ deleted: boolean }>(`/api/generated-subscriptions/${id}`, { method: "DELETE" }),
  publishGeneratedSubscription: (data: { profileId: string; name: string; targetFormat: TargetFormat; content: string; nodeCount: number; expiresAt?: string }) => request<GeneratedSubscription & { token: string }>("/api/generated-subscriptions", { method: "POST", body: JSON.stringify(data) }),

  createProject: (name = "我的配置") => request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  saveProject: (project: Project) => request<ProjectSummary>(`/api/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ name: project.name, config: project.config, targetFormat: project.targetFormat, updatedAt: project.updatedAt }) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  parseContent: (content: string, format: "auto" | "links" | TargetFormat = "auto") => request<{ config?: MihomoConfig; nodes: MihomoConfig["proxies"]; format: TargetFormat | "links"; warnings: string[]; issues: ValidationIssue[] }>("/api/tools/parse", { method: "POST", body: JSON.stringify({ content, format }) }),
  parseYaml: (yaml: string) => request<{ config: MihomoConfig; issues: ValidationIssue[] }>("/api/tools/parse", { method: "POST", body: JSON.stringify({ content: yaml, format: "mihomo" }) }),
  validate: (config: MihomoConfig) => request<{ issues: ValidationIssue[] }>("/api/tools/validate", { method: "POST", body: JSON.stringify({ config }) }),
  kernelInfo: () => request<KernelInfo[]>("/api/tools/kernels"),
  kernelValidate: (config: MihomoConfig, format: TargetFormat) => request<KernelValidationResult>("/api/tools/kernel-validate", { method: "POST", body: JSON.stringify({ config, format }) }),
  exportConfig: async (config: MihomoConfig, format: TargetFormat) => {
    const response = await fetchResponse("/api/tools/export", { method: "POST", body: JSON.stringify({ config, format }) });
    if (!isExportContent(response)) throw invalidResponse(response, "/api/tools/export", "了非文本导出内容");
    return response.text();
  },
  listSubscriptions: (projectId: string) => request<Subscription[]>(`/api/projects/${projectId}/subscriptions`),
  createSubscription: (projectId: string, data: Omit<Subscription, "id" | "projectId" | "lastUpdatedAt" | "lastError" | "nodeCount" | "createdAt">) => request<{ subscription: Subscription; config?: MihomoConfig; warnings?: string[]; error?: string; updatedAt?: string } | Subscription>(`/api/projects/${projectId}/subscriptions`, { method: "POST", body: JSON.stringify(data) }),
  updateSubscription: (projectId: string, id: string, data: Pick<Subscription, "name" | "url" | "format" | "intervalMinutes">) => request<Subscription>(`/api/projects/${projectId}/subscriptions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  refreshSubscription: (projectId: string, id: string) => request<{ subscription: Subscription; config: MihomoConfig; warnings: string[]; updatedAt: string }>(`/api/projects/${projectId}/subscriptions/${id}/update`, { method: "POST" }),
  deleteSubscription: (projectId: string, id: string, removeNodes = true) => request<void>(`/api/projects/${projectId}/subscriptions/${id}?removeNodes=${removeNodes}`, { method: "DELETE" }),
  listVersions: (projectId: string) => request<ProjectVersion[]>(`/api/projects/${projectId}/versions`),
  createVersion: (projectId: string, label = "手动快照") => request<ProjectVersion>(`/api/projects/${projectId}/versions`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreVersion: (projectId: string, id: string) => request<Project>(`/api/projects/${projectId}/versions/${id}/restore`, { method: "POST" }),
  downloadBackup: async () => {
    const response = await fetchResponse("/api/account/backup");
    if (!isJson(response)) throw invalidResponse(response, "/api/account/backup", "了非 JSON 内容");
    return response.blob();
  },
  restoreBackup: (content: string, mode: "merge" | "replace") => request<{ projects: number }>(`/api/account/restore?mode=${mode}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }),
};
