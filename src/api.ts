import type { MihomoConfig, Project, ProjectSummary, ValidationIssue } from "./shared/types";

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
  me: () => request<{ username: string | null }>("/api/auth/me"),
  login: (username: string, password: string) => request<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  listProjects: () => request<ProjectSummary[]>("/api/projects"),
  createProject: (name = "我的配置") => request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  saveProject: (project: Project) => request<ProjectSummary>(`/api/projects/${project.id}`, { method: "PUT", body: JSON.stringify({ name: project.name, config: project.config }) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  parseYaml: (yaml: string) => request<{ config: MihomoConfig; issues: ValidationIssue[] }>("/api/tools/parse", { method: "POST", body: JSON.stringify({ yaml }) }),
  validate: (config: MihomoConfig) => request<{ issues: ValidationIssue[] }>("/api/tools/validate", { method: "POST", body: JSON.stringify({ config }) }),
  exportYaml: async (config: MihomoConfig) => {
    const response = await fetch("/api/tools/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
    if (!response.ok) {
      const body = await response.json();
      const error = new Error(body.error) as Error & { issues?: ValidationIssue[] };
      error.issues = body.issues;
      throw error;
    }
    return response.text();
  },
};
