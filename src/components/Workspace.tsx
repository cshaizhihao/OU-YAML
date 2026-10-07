import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, CircleHelp, Database, Download, FileCode2, FolderPlus, Gauge, Group, History, LayoutDashboard, Library, LoaderCircle, LogOut, Menu, Rocket, Rss, Save, ScrollText, Settings, ShieldCheck, TerminalSquare, Upload, XCircle } from "lucide-react";
import { api } from "../api";
import { exportMihomoYaml, validateConfig } from "../shared/mihomo";
import { exportSingBoxJson } from "../shared/singbox";
import type { KernelValidationResult, MihomoConfig, Project, ProjectSummary, SessionUser, TargetFormat, ValidationIssue } from "../shared/types";
import { ImportCenter } from "./ImportCenter";
import { GroupsView } from "./views/GroupsView";
import { RulesView } from "./views/RulesView";
import { SettingsView } from "./views/SettingsView";
import { SourceView } from "./views/SourceView";
import { HistoryView } from "./views/HistoryView";
import { AdminView } from "./views/AdminView";
import { NodePoolView } from "./views/NodePoolView";
import { SourceManagerView } from "./views/SourceManagerView";
import { GeneratedSubscriptionsView } from "./views/GeneratedSubscriptionsView";
import { GeneratorView } from "./views/GeneratorView";
import { TemplatesView } from "./views/TemplatesView";
import { QuickStartView, type GuideTarget } from "./views/QuickStartView";

type View = "home" | "sources" | "nodes" | "groups" | "rules" | "preview" | "history" | "generator" | "links" | "templates" | "settings" | "admin";
type NavItem = { id: View; label: string; hint: string; icon: typeof Database; match: View[] };

const routes: Record<View, string> = {
  home: "/app/home",
  sources: "/app/sources",
  nodes: "/app/nodes",
  groups: "/app/workspace/groups",
  rules: "/app/workspace/rules",
  preview: "/app/workspace/preview",
  history: "/app/workspace/history",
  generator: "/app/publish/generate",
  links: "/app/publish/links",
  templates: "/app/templates",
  settings: "/app/system/settings",
  admin: "/app/system/users",
};

const routeEntries = Object.entries(routes) as [View, string][];
const viewFromPath = () => routeEntries.find(([, path]) => window.location.pathname === path)?.[0] || "home";

const baseNav: NavItem[] = [
  { id: "home", label: "首页", hint: "项目概览与进度", icon: LayoutDashboard, match: ["home"] },
  { id: "sources", label: "订阅来源", hint: "URL、文件与分享链接", icon: FolderPlus, match: ["sources"] },
  { id: "nodes", label: "节点库", hint: "筛选、整理与批量操作", icon: Database, match: ["nodes"] },
  { id: "groups", label: "配置工作台", hint: "分组、规则与预览", icon: Boxes, match: ["groups", "rules", "preview", "history"] },
  { id: "generator", label: "发布中心", hint: "生成方案与订阅链接", icon: Rocket, match: ["generator", "links"] },
  { id: "templates", label: "模板资源", hint: "复用规则与配置片段", icon: Library, match: ["templates"] },
  { id: "settings", label: "系统管理", hint: "项目、备份与更新", icon: Settings, match: ["settings", "admin"] },
];

const viewMeta: Record<View, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: "OVERVIEW", title: "项目首页", description: "查看配置完成度，并继续当前工作流。" },
  sources: { eyebrow: "LIBRARY / SOURCES", title: "订阅来源", description: "统一管理远程订阅、配置文件与分享链接。" },
  nodes: { eyebrow: "LIBRARY / NODES", title: "节点库", description: "整理所有来源节点，再选择加入当前项目。" },
  groups: { eyebrow: "WORKSPACE / GROUPS", title: "代理分组", description: "通过拖拽编排节点、策略组和链式代理。" },
  rules: { eyebrow: "WORKSPACE / RULES", title: "分流规则", description: "编辑匹配顺序、目标策略与规则模板。" },
  preview: { eyebrow: "WORKSPACE / PREVIEW", title: "预览校验", description: "检查最终配置源码并运行内核验证。" },
  history: { eyebrow: "WORKSPACE / HISTORY", title: "历史版本", description: "创建快照，或回滚到可靠配置。" },
  generator: { eyebrow: "PUBLISH / BUILDER", title: "生成订阅", description: "选择节点和模板，保存可复用生成方案。" },
  links: { eyebrow: "PUBLISH / LINKS", title: "发布链接", description: "管理公开地址、版本、过期时间与撤销状态。" },
  templates: { eyebrow: "RESOURCES / TEMPLATES", title: "模板资源", description: "创建和复用规则模板。" },
  settings: { eyebrow: "SYSTEM / SETTINGS", title: "系统设置", description: "管理项目参数、账号、备份与网页更新。" },
  admin: { eyebrow: "SYSTEM / USERS", title: "用户管理", description: "管理用户、权限和账号状态。" },
};

const workspaceTabs = [{ id: "groups" as View, label: "代理分组", icon: Group }, { id: "rules" as View, label: "分流规则", icon: ScrollText }, { id: "preview" as View, label: "预览校验", icon: FileCode2 }, { id: "history" as View, label: "历史版本", icon: History }];
const publishTabs = [{ id: "generator" as View, label: "生成方案", icon: Rocket }, { id: "links" as View, label: "发布链接", icon: Rss }];

export function Workspace({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<View>(() => {
    const initial = viewFromPath();
    return initial === "admin" && !user.isAdmin ? "settings" : initial;
  });
  const [status, setStatus] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [message, setMessage] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelResult, setKernelResult] = useState<KernelValidationResult | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const editRevision = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const savedVersion = useRef("");

  const loadProjects = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    const next = list.length ? await api.getProject(list[0].id) : await api.createProject("我的 OU-YAML 配置");
    if (!list.length) setProjects([next]);
    window.clearTimeout(saveTimer.current);
    editRevision.current += 1;
    savedVersion.current = next.updatedAt;
    setProject(next);
    setStatus("saved");
  }, []);

  useEffect(() => { loadProjects().catch((error) => setMessage(error.message)); }, [loadProjects]);
  useEffect(() => {
    const syncRoute = () => {
      const knownPath = routeEntries.some(([, path]) => window.location.pathname === path);
      const requested = knownPath ? viewFromPath() : "home";
      const next = requested === "admin" && !user.isAdmin ? "settings" : requested;
      if (window.location.pathname !== routes[next]) window.history.replaceState({}, "", routes[next]);
      setView(next);
    };
    syncRoute();
    const handlePopState = () => syncRoute();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user.isAdmin]);

  const navigate = useCallback((next: View, replace = false) => {
    setView(next);
    setMobileNav(false);
    window.history[replace ? "replaceState" : "pushState"]({}, "", routes[next]);
  }, []);

  const issues = useMemo(() => project ? validateConfig(project.config) : [], [project]);
  const errors = issues.filter((issue) => issue.level === "error").length;
  const nav = baseNav;
  const meta = viewMeta[view];

  const updateProject = useCallback((updater: (current: Project) => Project) => {
    editRevision.current += 1;
    setProject((current) => current ? updater(current) : current);
    setStatus("dirty");
  }, []);

  useEffect(() => {
    if (!project || status !== "dirty") return;
    window.clearTimeout(saveTimer.current);
    const snapshot = project;
    const revision = editRevision.current;
    saveTimer.current = window.setTimeout(async () => {
      if (revision !== editRevision.current) return;
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined);
      if (revision !== editRevision.current) return;
      setStatus("saving");
      const operation = (async () => {
        const saved = await api.saveProject({ ...snapshot, updatedAt: savedVersion.current || snapshot.updatedAt });
        savedVersion.current = saved.updatedAt;
        setProject((current) => current && current.id === snapshot.id ? { ...current, updatedAt: saved.updatedAt } : current);
        setProjects((current) => current.map((item) => item.id === snapshot.id ? saved : item));
        if (revision === editRevision.current) setStatus("saved");
      })();
      saveInFlight.current = operation;
      try { await operation; }
      catch (error) {
        if (revision === editRevision.current) {
          setStatus("error");
          setMessage(error instanceof Error && (error as Error & { status?: number }).status === 409 ? "项目已在其他操作中更新，请刷新项目后再保存" : error instanceof Error ? error.message : "保存失败");
        }
      } finally { if (saveInFlight.current === operation) saveInFlight.current = null; }
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
  }, [project, status]);

  async function chooseProject(id: string) {
    if (id === project?.id) return;
    if (status !== "saved") { setMessage("当前项目还有未完成的保存，请稍候再切换"); return; }
    const selected = await api.getProject(id);
    savedVersion.current = selected.updatedAt;
    setProject(selected);
    setStatus("saved");
  }

  async function reloadCurrentProject() {
    const currentId = project?.id;
    if (!currentId) return;
    window.clearTimeout(saveTimer.current);
    editRevision.current += 1;
    const refreshed = await api.getProject(currentId);
    savedVersion.current = refreshed.updatedAt;
    setProject(refreshed);
    setProjects((current) => current.map((item) => item.id === refreshed.id ? { id: refreshed.id, name: refreshed.name, updatedAt: refreshed.updatedAt } : item));
    setStatus("saved");
  }

  async function createProject() {
    const created = await api.createProject("新配置");
    savedVersion.current = created.updatedAt;
    setProjects((current) => [created, ...current]);
    setProject(created);
    navigate("groups");
  }

  async function importContent(content: string, format: "auto" | "links" | TargetFormat, filename?: string) {
    const parsed = await api.parseContent(content, format);
    if (parsed.config) {
      updateProject((current) => ({ ...current, name: filename ? filename.replace(/\.(ya?ml|json|txt)$/i, "") || current.name : current.name, config: parsed.config!, targetFormat: parsed.format as TargetFormat }));
      setMessage(`已导入 ${parsed.config.proxies.length} 个节点、${parsed.config.proxyGroups.length} 个策略组`);
    } else {
      updateProject((current) => {
        const used = new Set(current.config.proxies.map((node) => node.name));
        const nodes = parsed.nodes.map((node) => { const base = node.name; let name = base; let suffix = 2; while (used.has(name)) name = `${base} ${suffix++}`; used.add(name); return { ...node, name }; });
        return { ...current, config: { ...current.config, proxies: [...current.config.proxies, ...nodes] } };
      });
      setMessage(`已导入 ${parsed.nodes.length} 个节点${parsed.warnings.length ? `，${parsed.warnings.length} 行未识别` : ""}`);
    }
    return parsed;
  }

  async function download() {
    if (!project) return;
    try {
      const content = await api.exportConfig(project.config, project.targetFormat);
      const url = URL.createObjectURL(new Blob([content], { type: project.targetFormat === "sing-box" ? "application/json" : "application/yaml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name || "config"}.${project.targetFormat === "sing-box" ? "json" : "yaml"}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const value = error as Error & { issues?: ValidationIssue[] };
      setMessage(value.message);
      if (value.issues) setShowIssues(true);
    }
  }

  async function kernelValidate() {
    if (!project) return;
    setKernelBusy(true);
    setKernelResult(null);
    try { setKernelResult(await api.kernelValidate(project.config, project.targetFormat)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "内核检查失败"); }
    finally { setKernelBusy(false); }
  }

  if (!project) return <div className="app-loading"><Gauge className="spin" size={24} /><span>正在打开工作台</span></div>;
  const tabs = ["groups", "rules", "preview", "history"].includes(view) ? workspaceTabs : ["generator", "links"].includes(view) ? publishTabs : view === "settings" || view === "admin" ? [{ id: "settings" as View, label: "系统设置", icon: Settings }, ...(user.isAdmin ? [{ id: "admin" as View, label: "用户管理", icon: ShieldCheck }] : [])] : [];

  return <div className="workspace">
    <aside className={mobileNav ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-brand"><div className="brand-mark"><img src="/brand/ou-yaml-logo.png" alt="OU-YAML" /></div><div><strong>OU-YAML</strong><small>Configuration Studio</small></div><button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="关闭导航"><XCircle size={20} /></button></div>
      <nav aria-label="主要导航">{nav.map(({ id, label, hint, icon: Icon, match }) => <button key={id} className={match.includes(view) ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}><Icon size={19} /><span><strong>{label}</strong><small>{hint}</small></span>{id === "nodes" && <b>{project.config.proxies.length}</b>}</button>)}</nav>
      <div className="sidebar-help"><CircleHelp size={17} /><span><strong>需要从哪里开始？</strong><small>首页会根据当前配置提示下一步。</small></span></div>
      <div className="sidebar-foot"><div className="user-chip"><span>{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.isAdmin ? "管理员" : "用户"}</small></div></div><button className="icon-button" title="退出登录" aria-label="退出登录" onClick={async () => { await api.logout(); onLogout(); }}><LogOut size={18} /></button></div>
    </aside>
    {mobileNav && <button className="mobile-nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航菜单" />}

    <main className="main-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={20} /></button>
        <div className="project-select-wrap"><select aria-label="当前配置" value={project.id} onChange={(event) => void chooseProject(event.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></div>
        <button className="icon-button new-project-action" onClick={() => void createProject()} title="新建配置" aria-label="新建配置"><FolderPlus size={18} /></button>
        <div className="save-state" aria-live="polite">{status === "saving" ? <><Save className="spin" size={15} />保存中</> : status === "error" ? <><XCircle size={15} />保存失败</> : <><CheckCircle2 size={15} />已保存</>}</div>
        <div className="top-actions">
          <button className="secondary-button top-import-action" onClick={() => setShowImport(true)}><Upload size={17} /><span>导入配置</span></button>
          <select className="format-select" value={project.targetFormat} onChange={(event) => updateProject((current) => ({ ...current, targetFormat: event.target.value as TargetFormat }))} aria-label="导出格式"><option value="mihomo">YAML</option><option value="sing-box">JSON</option></select>
          <button className="primary-button" onClick={() => void download()} disabled={errors > 0}><Download size={17} /><span>导出</span></button>
        </div>
      </header>

      <div className="page-heading">
        <div><div className="eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p></div>
        <button className={errors ? "validation-pill error" : issues.length ? "validation-pill warning" : "validation-pill ok"} onClick={() => setShowIssues(!showIssues)}>{errors ? <XCircle size={17} /> : issues.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{errors ? `${errors} 个错误` : issues.length ? `${issues.length} 个提醒` : "配置正常"}</button>
      </div>

      {tabs.length > 0 && <nav className="section-tabs" aria-label="当前模块">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={16} />{label}</button>)}</nav>}

      {showIssues && <section className="issues-panel" aria-label="配置检查"><header><strong>配置检查</strong><div className="panel-actions"><button className="secondary-button compact-button" disabled={kernelBusy} onClick={() => void kernelValidate()}>{kernelBusy ? <LoaderCircle className="spin" size={15} /> : <TerminalSquare size={15} />}内核实测</button><button className="icon-button compact" onClick={() => setShowIssues(false)} aria-label="关闭"><XCircle size={18} /></button></div></header>{issues.length ? issues.map((issue, index) => <div className={`issue-row ${issue.level}`} key={`${issue.message}-${index}`}>{issue.level === "error" ? <XCircle size={17} /> : <AlertTriangle size={17} />}<span>{issue.message}</span></div>) : <div className="issue-empty"><CheckCircle2 size={18} />未发现问题</div>}{kernelResult && <div className={`kernel-result ${!kernelResult.available ? "warning" : kernelResult.valid ? "success" : "error"}`}><div>{!kernelResult.available ? <AlertTriangle size={17} /> : kernelResult.valid ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<strong>{!kernelResult.available ? "内核不可用" : kernelResult.valid ? "内核检查通过" : "内核检查失败"}</strong></div><pre>{kernelResult.output}</pre></div>}</section>}

      <section className="content-area" key={view}>
        {view === "home" && <QuickStartView project={project} onNavigate={(target: GuideTarget) => navigate(target)} onDownload={download} />}
        {view === "sources" && <SourceManagerView onProjectReload={reloadCurrentProject} onMessage={setMessage} />}
        {view === "nodes" && <NodePoolView config={project.config} onConfig={(config) => updateProject((current) => ({ ...current, config }))} onProjectReload={reloadCurrentProject} onMessage={setMessage} />}
        {view === "groups" && <GroupsView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} />}
        {view === "rules" && <RulesView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "preview" && <SourceView config={project.config} format={project.targetFormat} source={project.targetFormat === "sing-box" ? exportSingBoxJson(project.config) : exportMihomoYaml(project.config)} onApply={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "history" && <HistoryView project={project} onRestore={(restored) => { savedVersion.current = restored.updatedAt; setProject(restored); setStatus("saved"); }} onMessage={setMessage} />}
        {view === "generator" && <GeneratorView project={project} onMessage={setMessage} />}
        {view === "links" && <GeneratedSubscriptionsView onMessage={setMessage} />}
        {view === "templates" && <TemplatesView onMessage={setMessage} />}
        {view === "settings" && <SettingsView project={project} isAdmin={user.isAdmin} onChange={updateProject} onReload={loadProjects} onMessage={setMessage} />}
        {view === "admin" && user.isAdmin && <AdminView currentUser={user} onMessage={setMessage} />}
      </section>
      <ImportCenter open={showImport} onClose={() => setShowImport(false)} onImport={importContent} />
      {message && <div className="toast" role="status"><CircleHelp size={18} /><span>{message}</span><button className="icon-button compact" onClick={() => setMessage("")} aria-label="关闭"><XCircle size={17} /></button></div>}
    </main>
  </div>;
}
