import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, CircleHelp, Database, Download, FileCode2, FolderPlus, Gauge, Group, History, LayoutDashboard, Library, LoaderCircle, LogOut, Menu, Rocket, Rss, Save, ScrollText, Settings, ShieldCheck, TerminalSquare, Upload, XCircle } from "lucide-react";
import { api } from "../api";
import { exportMihomoYaml, validateConfig } from "../shared/mihomo";
import { exportSingBoxJson } from "../shared/singbox";
import { previewExport } from "../shared/exportConfig";
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
import { GuideExperience, useGuideController } from "./GuidedTour";
import { guideTargets, type GuideView } from "../guides/registry";
import { SubscriptionHomeView } from "./views/SubscriptionHomeView";
import { SubscriptionEditorView } from "./views/SubscriptionEditorView";
import type { SubscriptionEditorTab } from "../shared/subscriptionEditor";

type View = GuideView;
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
  subscription: "/app/publish/edit",
  templates: "/app/templates",
  settings: "/app/system/settings",
  admin: "/app/system/users",
};

const routeEntries = Object.entries(routes) as [View, string][];
const viewFromPath = () => routeEntries.find(([, path]) => window.location.pathname === path)?.[0] || "home";

const primaryNav: NavItem[] = [
  { id: "home", label: "我的订阅", hint: "复制、改名、再次编辑与更新", icon: LayoutDashboard, match: ["home", "subscription"] },
  { id: "sources", label: "订阅来源", hint: "订阅、文件与分享链接", icon: FolderPlus, match: ["sources"] },
  { id: "nodes", label: "节点库", hint: "整理、检测并加入项目", icon: Database, match: ["nodes"] },
  { id: "groups", label: "代理分组", hint: "选择、测速与链式代理", icon: Boxes, match: ["groups", "preview", "history"] },
  { id: "rules", label: "中文分流", hint: "中文规则与常用模板", icon: ScrollText, match: ["rules"] },
  { id: "generator", label: "高级发布", hint: "检查并发布稳定链接", icon: Rocket, match: ["generator", "links"] },
];

const secondaryNav: NavItem[] = [
  { id: "templates", label: "模板资源", hint: "复用规则与配置片段", icon: Library, match: ["templates"] },
  { id: "settings", label: "系统设置", hint: "项目、备份、账号与更新", icon: Settings, match: ["settings", "admin"] },
];

const viewMeta: Record<View, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: "订阅工作台", title: "我的订阅", description: "第一次用三步创建，之后在这里管理；不必每次重新配置。" },
  sources: { eyebrow: "来源管理", title: "导入节点", description: "添加远程订阅、配置文件或节点分享链接。" },
  nodes: { eyebrow: "节点管理", title: "选择节点", description: "整理节点、检测连通性，再加入当前项目。" },
  groups: { eyebrow: "高级配置", title: "设置代理", description: "通过拖拽设置节点选择、自动测速和链式代理。" },
  rules: { eyebrow: "高级配置", title: "设置分流", description: "使用中文规则决定不同流量的连接方式。" },
  preview: { eyebrow: "高级工具", title: "预览校验", description: "检查最终配置源码并运行内核验证。" },
  history: { eyebrow: "安全保护", title: "历史版本", description: "创建快照，或回滚到可靠配置。" },
  generator: { eyebrow: "高级发布", title: "生成订阅", description: "跟随向导检查配置并发布稳定订阅链接。" },
  links: { eyebrow: "订阅管理", title: "发布链接", description: "管理公开地址、版本、过期时间与撤销状态。" },
  subscription: { eyebrow: "订阅编辑", title: "编辑已生成的订阅", description: "修改节点、分组或规则，确认后更新原地址，不用从头生成。" },
  templates: { eyebrow: "高级工具", title: "模板资源", description: "创建和复用规则模板。" },
  settings: { eyebrow: "系统管理", title: "系统设置", description: "管理项目参数、账号、备份与网页更新。" },
  admin: { eyebrow: "系统管理", title: "用户管理", description: "管理用户、权限和账号状态。" },
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
  const messageTimer = useRef<number | undefined>(undefined);
  const editRevision = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const savedVersion = useRef("");
  const currentUrl = useRef(window.location.pathname + window.location.search);
  const [, setRouteRevision] = useState(0);

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
    window.clearTimeout(messageTimer.current);
    if (!message) return;
    messageTimer.current = window.setTimeout(() => setMessage(""), 4200);
    return () => window.clearTimeout(messageTimer.current);
  }, [message]);
  useEffect(() => {
    const syncRoute = () => {
      const knownPath = routeEntries.some(([, path]) => window.location.pathname === path);
      const requested = knownPath ? viewFromPath() : "home";
      const next = requested === "admin" && !user.isAdmin ? "settings" : requested;
      if (window.location.pathname !== routes[next]) window.history.replaceState({}, "", routes[next]);
      setView(next);
    };
    syncRoute();
    const handlePopState = () => {
      if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) { window.history.pushState({}, "", currentUrl.current); return; }
      currentUrl.current = window.location.pathname + window.location.search;
      setRouteRevision((value) => value + 1);
      syncRoute();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [user.isAdmin]);

  const navigate = useCallback((next: View, replace = false) => {
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    setView(next);
    setMobileNav(false);
    window.history[replace ? "replaceState" : "pushState"]({}, "", routes[next]);
    currentUrl.current = routes[next];
  }, []);
  const guide = useGuideController(user.username);
  function editSubscription(id: string, tab: SubscriptionEditorTab) {
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    setView("subscription");
    setMobileNav(false);
    const address = `${routes.subscription}?id=${encodeURIComponent(id)}&tab=${tab}`;
    window.history.pushState({}, "", address);
    currentUrl.current = address;
    if (tab === "rules") window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: "subscription-rules-opened" }));
  }
  function openQuickPublish() {
    guide.pause();
    navigate("home");
    const address = `${routes.home}?step=1`;
    window.history.replaceState({}, "", address);
    currentUrl.current = address;
  }

  const issues = useMemo(() => project ? validateConfig(project.config) : [], [project]);
  const errors = issues.filter((issue) => issue.level === "error").length;
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
    if (status !== "saved") { setMessage("请等待当前配置保存成功再新建"); return; }
    const created = await api.createProject("我的新订阅");
    savedVersion.current = created.updatedAt;
    setProjects((current) => [created, ...current]);
    setProject(created);
    setStatus("saved");
    navigate("home");
    const address = `${routes.home}?step=0`;
    window.history.replaceState({}, "", address);
    currentUrl.current = address;
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
      <nav aria-label="主要导航" data-guide-id={guideTargets.mainNavigation}>{primaryNav.map(({ id, label, hint, icon: Icon, match }) => <button key={id} className={match.includes(view) ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}><Icon size={19} /><span><strong>{label}</strong><small>{hint}</small></span>{id === "nodes" && <b>{project.config.proxies.length}</b>}</button>)}<span className="sidebar-section-label">更多工具</span>{secondaryNav.map(({ id, label, hint, icon: Icon, match }) => <button key={id} className={match.includes(view) ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}><Icon size={19} /><span><strong>{label}</strong><small>{hint}</small></span></button>)}</nav>
      <button className="sidebar-help" onClick={guide.openCenter}><CircleHelp size={17} /><span><strong>不知道怎么操作？</strong><small>打开跳转式新手教程。</small></span></button>
      <div className="sidebar-foot"><div className="user-chip"><span>{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.isAdmin ? "管理员" : "用户"}</small></div></div><button className="icon-button" title="退出登录" aria-label="退出登录" onClick={async () => { if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return; await api.logout(); onLogout(); }}><LogOut size={18} /></button></div>
    </aside>
    {mobileNav && <button className="mobile-nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航菜单" />}

    <main className="main-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={20} /></button>
        {view !== "subscription" && <><div className="project-select-wrap" data-guide-id={guideTargets.projectSelector}><select aria-label="当前配置" value={project.id} onChange={(event) => void chooseProject(event.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></div>
        <button className="icon-button new-project-action" onClick={() => void createProject()} title="新建配置" aria-label="新建配置"><FolderPlus size={18} /></button>
        <div className="save-state" aria-live="polite">{status === "saving" ? <><Save className="spin" size={15} />草稿保存中</> : status === "dirty" ? <><Save size={15} />等待保存</> : status === "error" ? <><XCircle size={15} />草稿保存失败</> : <><CheckCircle2 size={15} />草稿已保存</>}</div>
        <div className="top-actions">
          <button className="secondary-button top-import-action" onClick={() => setShowImport(true)}><Upload size={17} /><span>导入配置</span></button>
          <select className="format-select" value={project.targetFormat} onChange={(event) => updateProject((current) => ({ ...current, targetFormat: event.target.value as TargetFormat }))} aria-label="导出格式"><option value="mihomo">YAML</option><option value="sing-box">JSON</option></select>
          <button className="primary-button" onClick={() => void download()} disabled={errors > 0}><Download size={17} /><span>导出</span></button>
        </div></>}
      </header>

      <div className="page-heading">
        <div><div className="eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p></div>
        {view !== "subscription" && view !== "home" && <button className={errors ? "validation-pill error" : issues.length ? "validation-pill warning" : "validation-pill ok"} onClick={() => setShowIssues(!showIssues)}>{errors ? <XCircle size={17} /> : issues.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{errors ? `${errors} 个错误` : issues.length ? `${issues.length} 个提醒` : "配置正常"}</button>}
      </div>

      {tabs.length > 0 && <nav className="section-tabs" aria-label="当前模块">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={16} />{label}</button>)}</nav>}

      {showIssues && <section className="issues-panel" aria-label="配置检查"><header><strong>配置检查</strong><div className="panel-actions"><button className="secondary-button compact-button" disabled={kernelBusy} onClick={() => void kernelValidate()}>{kernelBusy ? <LoaderCircle className="spin" size={15} /> : <TerminalSquare size={15} />}内核实测</button><button className="icon-button compact" onClick={() => setShowIssues(false)} aria-label="关闭"><XCircle size={18} /></button></div></header>{issues.length ? issues.map((issue, index) => <div className={`issue-row ${issue.level}`} key={`${issue.message}-${index}`}>{issue.level === "error" ? <XCircle size={17} /> : <AlertTriangle size={17} />}<span>{issue.message}</span></div>) : <div className="issue-empty"><CheckCircle2 size={18} />未发现问题</div>}{kernelResult && <div className={`kernel-result ${!kernelResult.available ? "warning" : kernelResult.valid ? "success" : "error"}`}><div>{!kernelResult.available ? <AlertTriangle size={17} /> : kernelResult.valid ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<strong>{!kernelResult.available ? "内核不可用" : kernelResult.valid ? "内核检查通过" : "内核检查失败"}</strong></div><pre>{kernelResult.output}</pre></div>}</section>}

      <section className="content-area" key={view}>
        {view === "home" && <><SubscriptionHomeView key={project.id} project={project} canPublish={status === "saved"} onReload={reloadCurrentProject} onNavigate={(next) => { guide.pause(); navigate(next); }} onStartGuide={guide.start} onEdit={editSubscription} onCreate={() => { if (status !== "saved") { setMessage("请等待当前配置保存成功"); return; } void createProject().then(() => guide.start("quickstart")).catch((error) => setMessage(error.message)); }} /><details className="advanced-dashboard"><summary>高级配置详情与历史流程</summary><QuickStartView project={project} onNavigate={(target: GuideTarget) => navigate(target)} onDownload={download} onStartGuide={() => guide.start("quickstart")} /></details></>}
        {view === "sources" && <SourceManagerView onProjectReload={reloadCurrentProject} onMessage={setMessage} />}
        {view === "nodes" && <NodePoolView config={project.config} onConfig={(config) => updateProject((current) => ({ ...current, config }))} onProjectReload={reloadCurrentProject} onMessage={setMessage} onOpenSources={() => navigate("sources")} />}
        {view === "groups" && <><div className="draft-flow"><span>导入节点 → 编辑分组 → 检查并生成订阅</span><button className="primary-button" disabled={status !== "saved"} onClick={openQuickPublish}>下一步：生成订阅</button></div><GroupsView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} /></>}
        {view === "rules" && <RulesView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "preview" && <>{previewExport(project.config, project.targetFormat).issues.filter((issue) => issue.level === "error").map((issue, index) => <p role="alert" key={index}>{issue.message}</p>)}<SourceView config={project.config} format={project.targetFormat} source={previewExport(project.config, project.targetFormat).content} onApply={(config) => updateProject((current) => ({ ...current, config }))} /></>}
        {view === "history" && <HistoryView project={project} onRestore={(restored) => { savedVersion.current = restored.updatedAt; setProject(restored); setStatus("saved"); }} onMessage={setMessage} />}
        {view === "generator" && <GeneratorView project={project} onMessage={setMessage} />}
        {view === "links" && <GeneratedSubscriptionsView onMessage={setMessage} onEdit={editSubscription} />}
        {view === "subscription" && <SubscriptionEditorView key={window.location.search} id={new URLSearchParams(window.location.search).get("id") || ""} initialTab={new URLSearchParams(window.location.search).get("tab") === "rules" ? "rules" : new URLSearchParams(window.location.search).get("tab") === "nodes" ? "nodes" : "groups"} onBack={() => navigate("home")} onMessage={setMessage} />}
        {view === "templates" && <TemplatesView onMessage={setMessage} />}
        {view === "settings" && <SettingsView project={project} isAdmin={user.isAdmin} onChange={updateProject} onReload={loadProjects} onMessage={setMessage} />}
        {view === "admin" && user.isAdmin && <AdminView currentUser={user} onMessage={setMessage} />}
      </section>
      <ImportCenter open={showImport} onClose={() => setShowImport(false)} onImport={importContent} />
      {message && <div className="toast" role="status"><CircleHelp size={18} /><span>{message}</span><button className="icon-button compact" onClick={() => setMessage("")} aria-label="关闭"><XCircle size={17} /></button></div>}
    </main>
    <GuideExperience controller={guide} username={user.username} currentView={view} navigate={navigate} />
  </div>;
}
