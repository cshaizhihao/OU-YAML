import type { NodeSource, ManagedNode, GenerationProfile, GeneratedSubscription } from "./shared/domain";
import type { KernelInfo, KernelValidationResult, MihomoConfig, Project, ProjectSummary, ProjectVersion, SessionUser, Subscription, TargetFormat, UserAccount, ValidationIssue } from "./shared/types";


export type UpdateInfo = { currentVersion: string; latestVersion: string | null; currentCommit: string | null; latestCommit: string | null; updateKind: "version" | "build" | null; hasUpdate: boolean; releaseUrl: string | null; releaseNotes: string; publishedAt: string | null; agentAvailable: boolean };
export type UpdateStatus = { status: "idle" | "requested" | "running" | "completed" | "failed"; message: string; progress: number; updatedAt: string | null };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "请求失败" }));
    const error = new Error(body.error || "请求失败") as Error & { issues?: ValidationIssue[]; status?: number };
    error.issues = body.issues;
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ username: string | null; isAdmin: boolean }>("/api/auth/me"),
  login: (username: string, password: string) => request<SessionUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  listUsers: () => request<UserAccount[]>("/api/admin/users"),
  createUser: (username: string, password: string, isAdmin: boolean) => request<UserAccount>("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password, isAdmin }) }),
  updateUser: (id: string, data: { isAdmin: boolean; disabled: boolean; password?: string }) => request<UserAccount>(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: string) => request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
  checkUpdate: () => request<UpdateInfo>("/api/admin/update/check"),
  getUpdateStatus: () => request<UpdateStatus>("/api/admin/update/status"),
  getUpdateLog: () => request<{ log: string }>("/api/admin/update/log"),
  startUpdate: () => request<{ accepted: boolean }>("/api/admin/update/start", { method: "POST" }),
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  listNodeSources: () => request<NodeSource[]>("/api/node-sources"),
  createNodeSource: (data: Pick<NodeSource, "name" | "kind" | "format" | "enabled"> & { url?: string }) => request<NodeSource>("/api/node-sources", { method: "POST", body: JSON.stringify(data) }),
  updateNodeSource: (id: string, data: Pick<NodeSource, "name" | "kind" | "format" | "enabled"> & { url?: string }) => request<NodeSource>(`/api/node-sources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  refreshNodeSource: (id: string) => request<{ source: NodeSource; nodes: ManagedNode[]; warnings: string[] }>(`/api/node-sources/${id}/refresh`, { method: "POST" }),
  importNodeSource: (id: string, content: string) => request<{ source: NodeSource; nodes: ManagedNode[]; warnings: string[] }>(`/api/node-sources/${id}/import`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content }),
  listManagedNodes: (sourceId?: string) => request<ManagedNode[]>(`/api/managed-nodes${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`),
  createManagedNode: (data: Partial<ManagedNode> & Pick<ManagedNode, "name" | "type" | "server" | "port">) => request<ManagedNode>("/api/managed-nodes", { method: "POST", body: JSON.stringify(data) }),
  updateManagedNode: (id: string, data: Partial<ManagedNode> & Pick<ManagedNode, "name" | "type" | "server" | "port">) => request<ManagedNode>(`/api/managed-nodes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  reorderManagedNodes: (ids: string[]) => request<ManagedNode[]>("/api/managed-nodes/order", { method: "PUT", body: JSON.stringify({ ids }) }),
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
  createGenerationProfile: (data: Pick<GenerationProfile, "name" | "targetFormat" | "config"> & { nodeIds?: string[]; sourceIds?: string[]; templateId?: string }) => request<GenerationProfile>("/api/generation-profiles", { method: "POST", body: JSON.stringify(data) }),
  listGeneratedSubscriptions: () => request<GeneratedSubscription[]>("/api/generated-subscriptions"),
  revokeGeneratedSubscription: (id: string) => request<{ revoked: boolean }>(`/api/generated-subscriptions/${id}/revoke`, { method: "POST" }),
  rotateGeneratedSubscriptionToken: (id: string) => request<{ token: string }>(`/api/generated-subscriptions/${id}/token`, { method: "POST" }),
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
    const response = await fetch("/api/tools/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, format }) });
    if (!response.ok) {
      const body = await response.json();
      const error = new Error(body.error) as Error & { issues?: ValidationIssue[] };
      error.issues = body.issues;
      throw error;
    }
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
    const response = await fetch("/api/account/backup");
    if (!response.ok) throw new Error("备份下载失败");
    return response.blob();
  },
  restoreBackup: async (content: string, mode: "merge" | "replace") => {
    const response = await fetch(`/api/account/restore?mode=${mode}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: content });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "恢复失败");
    return body as { projects: number };
  },
};
