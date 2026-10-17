import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, CircleHelp, Database, Download, FileCode2, FolderPlus, Gauge, Group, History, LayoutDashboard, Library, LoaderCircle, LogOut, MoreHorizontal, Rocket, Rss, Save, ScrollText, Settings, ShieldCheck, TerminalSquare, Upload, XCircle } from "lucide-react";
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
import { GuideExperience, GuideTrigger, useGuideController } from "./GuidedTour";
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
  home: { eyebrow: "工作台", title: "我的订阅", description: "云端订阅编排中心" },
  sources: { eyebrow: "资产管理", title: "订阅来源", description: "管理远程订阅、节点分享与本地配置" },
  nodes: { eyebrow: "资产中心", title: "节点资产库", description: "全局节点健康探测与分组编排" },
  groups: { eyebrow: "流控编排", title: "代理分组", description: "可视化策略组拓扑与分流构建" },
  rules: { eyebrow: "规则引擎", title: "中文分流", description: "智能中文规则意图与流量路由" },
  preview: { eyebrow: "实时仿真", title: "配置预览", description: "配置代码高亮与内核语法沙箱检验" },
  history: { eyebrow: "版本控制", title: "历史版本", description: "配置时光机与安全快照还原" },
  generator: { eyebrow: "交付中心", title: "发布订阅", description: "高性能公开发布与客户端直连" },
  links: { eyebrow: "交付中心", title: "发布链接", description: "安全访问凭证与订阅热更新" },
  subscription: { eyebrow: "热重载", title: "编辑订阅", description: "原地无感差量热更新" },
  templates: { eyebrow: "资产复用", title: "模板资源", description: "经典分流规则集与编排模板" },
  settings: { eyebrow: "控制台", title: "系统设置", description: "项目运行参数、数据备份与在线升级" },
  admin: { eyebrow: "控制台", title: "用户管理", description: "多用户权限控制与租户隔离" },
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
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [showIssues, setShowIssues] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelResult, setKernelResult] = useState<KernelValidationResult | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const messageTimer = useRef<number | undefined>(undefined);
  const editRevision = useRef(0);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const savedVersion = useRef("");
  const projectRef = useRef<Project | null>(null);
  const statusRef = useRef(status);
  const projectEpoch = useRef(0);
  const projectRequest = useRef(0);
  const currentUrl = useRef(window.location.pathname + window.location.search);
  const [, setRouteRevision] = useState(0);
  projectRef.current = project;
  statusRef.current = status;

  const replaceProject = useCallback((next: Project) => {
    window.clearTimeout(saveTimer.current);
    editRevision.current += 1;
    projectEpoch.current += 1;
    savedVersion.current = next.updatedAt;
    projectRef.current = next;
    statusRef.current = "saved";
    setProject(next);
    setStatus("saved");
  }, []);

  const loadProjects = useCallback(async () => {
    if (statusRef.current !== "saved" || saveInFlight.current) throw new Error("当前草稿尚未保存成功，已保留页面中的修改。");
    setLoadError("");
    const request = ++projectRequest.current;
    const revision = editRevision.current;
    const list = await api.listProjects();
    const next = list.length ? await api.getProject(list[0].id) : await api.createProject("我的 OU-YAML 配置");
    if (request !== projectRequest.current || revision !== editRevision.current) return;
    setProjects(list.length ? list : [next]);
    replaceProject(next);
  }, [replaceProject]);

  useEffect(() => { void loadProjects().catch((error) => setLoadError(error.message)); }, [loadProjects]);
  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving" || status === "error") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [status]);
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
    if (window.location.pathname === routes[next] && !window.location.search) return true;
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return false;
    setView(next);
    window.history[replace ? "replaceState" : "pushState"]({}, "", routes[next]);
    currentUrl.current = routes[next];
    setRouteRevision((value) => value + 1);
    return true;
  }, []);
  const guide = useGuideController(user.username);
  function editSubscription(id: string, tab: SubscriptionEditorTab) {
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    setView("subscription");
    const address = `${routes.subscription}?id=${encodeURIComponent(id)}&tab=${tab}`;
    window.history.pushState({}, "", address);
    currentUrl.current = address;
    setRouteRevision((value) => value + 1);
    if (tab === "rules") window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: "subscription-rules-opened" }));
  }
  function openQuickPublish() {
    if (!navigate("home")) return;
    guide.pause();
    const address = `${routes.home}?step=1`;
    window.history.replaceState({}, "", address);
    currentUrl.current = address;
    setRouteRevision((value) => value + 1);
    window.dispatchEvent(new CustomEvent("ou-yaml:quick-step", { detail: 1 }));
  }

  const issues = useMemo(() => project ? validateConfig(project.config) : [], [project]);
  const errors = issues.filter((issue) => issue.level === "error").length;
  const meta = viewMeta[view];

  const updateProject = useCallback((updater: (current: Project) => Project) => {
    editRevision.current += 1;
    setProject((current) => {
      if (!current) return current;
      const next = updater(current);
      projectRef.current = next;
      return next;
    });
    statusRef.current = "dirty";
    setStatus("dirty");
  }, []);

  useEffect(() => {
    if (!project || status !== "dirty") return;
    window.clearTimeout(saveTimer.current);
    const snapshot = project;
    const revision = editRevision.current;
    const epoch = projectEpoch.current;
    let cancelled = false;
    saveTimer.current = window.setTimeout(async () => {
      if (revision !== editRevision.current) return;
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined);
      if (cancelled || revision !== editRevision.current || epoch !== projectEpoch.current) return;
      statusRef.current = "saving";
      setStatus("saving");
      const operation = (async () => {
        const saved = await api.saveProject({ ...snapshot, updatedAt: savedVersion.current || snapshot.updatedAt });
        if (epoch !== projectEpoch.current) return;
        savedVersion.current = saved.updatedAt;
        setProject((current) => current && current.id === snapshot.id ? { ...current, updatedAt: saved.updatedAt } : current);
        setProjects((current) => current.map((item) => item.id === snapshot.id ? saved : item));
        if (revision === editRevision.current) { statusRef.current = "saved"; setStatus("saved"); }
      })();
      saveInFlight.current = operation;
      try { await operation; }
      catch (error) {
        if (epoch === projectEpoch.current && revision === editRevision.current) {
          statusRef.current = "error";
          setStatus("error");
          setMessage(error instanceof Error && (error as Error & { status?: number }).status === 409 ? "项目已在其他操作中更新，草稿已保留。请先导出当前草稿，再重新载入核对。" : `${error instanceof Error ? error.message : "保存失败"}；草稿已保留，可重试保存。`);
        }
      } finally { if (saveInFlight.current === operation) saveInFlight.current = null; }
    }, 700);
    return () => { cancelled = true; window.clearTimeout(saveTimer.current); };
  }, [project, status]);

  async function chooseProject(id: string) {
    if (id === project?.id) return;
    if (statusRef.current !== "saved" || saveInFlight.current) { setMessage("当前项目还有未完成的保存，请稍候再切换"); return; }
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    const request = ++projectRequest.current;
    const revision = editRevision.current;
    try {
      const selected = await api.getProject(id);
      if (request !== projectRequest.current) return;
      if (revision !== editRevision.current) { setMessage("切换期间有新修改，已保留当前草稿，请保存后再切换。"); return; }
      replaceProject(selected);
    } catch (error) { if (request === projectRequest.current) setMessage(`切换失败，当前草稿已保留：${error instanceof Error ? error.message : "请稍后重试"}`); }
  }

  async function reloadCurrentProject() {
    const currentId = project?.id;
    if (!currentId) return;
    if (projectRef.current?.id !== currentId) throw new Error("当前配置已切换，请回到原配置核对操作结果。");
    if (statusRef.current !== "saved" || saveInFlight.current) throw new Error("当前草稿尚未保存成功，已保留页面中的修改，请保存后再刷新。");
    const request = ++projectRequest.current;
    const revision = editRevision.current;
    const refreshed = await api.getProject(currentId);
    if (request !== projectRequest.current || revision !== editRevision.current) throw new Error("刷新期间配置发生变化，当前草稿已保留，请核对后重试。");
    replaceProject(refreshed);
    setProjects((current) => current.map((item) => item.id === refreshed.id ? { id: refreshed.id, name: refreshed.name, updatedAt: refreshed.updatedAt } : item));
  }

  async function createProject() {
    if (statusRef.current !== "saved" || saveInFlight.current) { setMessage("请等待当前配置保存成功再新建"); return false; }
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return false;
    const request = ++projectRequest.current;
    const revision = editRevision.current;
    try {
      const created = await api.createProject("我的新订阅");
      setProjects((current) => [created, ...current]);
      if (request !== projectRequest.current || revision !== editRevision.current) { setMessage("新配置已创建，当前草稿已保留。保存后可从配置列表切换。"); return false; }
      if (window.location.pathname !== routes.home && !navigate("home")) return false;
      replaceProject(created);
      const address = `${routes.home}?step=0`;
      window.history.replaceState({}, "", address);
      currentUrl.current = address;
      setRouteRevision((value) => value + 1);
      return true;
    } catch (error) { setMessage(`创建失败：${error instanceof Error ? error.message : "请稍后重试"}`); return false; }
  }

  async function importContent(content: string, format: "auto" | "links" | TargetFormat, filename?: string) {
    const revision = editRevision.current;
    const parsed = await api.parseContent(content, format);
    if (revision !== editRevision.current) throw new Error("导入期间配置发生变化，当前草稿已保留，请重新导入。");
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

  async function logout() {
    if (statusRef.current !== "saved" || saveInFlight.current) { setMessage("草稿尚未保存成功，请保存后再退出登录。"); return; }
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    try { await api.logout(); onLogout(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "退出失败，请重试"); }
  }

  if (!project) return <div className="app-loading">{loadError ? <><p role="alert">工作台加载失败：{loadError}</p><button className="secondary-button" onClick={() => void loadProjects().catch((error) => setLoadError(error.message))}>重新加载</button></> : <><Gauge className="spin" size={24} /><span>正在打开工作台</span></>}</div>;
  const tabs = ["groups", "rules", "preview", "history"].includes(view) ? workspaceTabs : ["generator", "links"].includes(view) ? publishTabs : view === "settings" || view === "admin" ? [{ id: "settings" as View, label: "系统设置", icon: Settings }, ...(user.isAdmin ? [{ id: "admin" as View, label: "用户管理", icon: ShieldCheck }] : [])] : [];

  return <div className="workspace">
    <main className={`main-shell${view === "groups" ? " group-workspace" : view === "rules" ? " rules-workspace" : view === "subscription" ? " subscription-workspace" : ""}`}>
      <header className="topbar">
        <div className="topbar-brand"><div className="brand-mark"><img src="/brand/ou-yaml-logo.png" alt="OU-YAML" /></div><div><strong>OU-YAML</strong><small>Nightflight 1.0</small></div></div>
        <div className="project-select-wrap" data-guide-id={guideTargets.projectSelector}><select aria-label="当前配置" title={project.name} value={project.id} onChange={(event) => void chooseProject(event.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></div>
        <button className="icon-button new-project-action" onClick={() => void createProject()} title="新建配置" aria-label="新建配置"><FolderPlus size={18} /></button>
        <nav className="top-nav" aria-label="主要导航" data-guide-id={guideTargets.mainNavigation}>{primaryNav.map(({ id, label, hint, icon: Icon, match }) => <button key={id} className={match.includes(view) ? "active" : ""} onClick={() => navigate(id)} aria-label={label} title={`${label}：${hint}`}><Icon size={15} /><span>{id === "home" ? "总览" : id === "sources" ? "订阅" : id === "nodes" ? "节点库" : id === "groups" ? "策略组" : id === "rules" ? "分流规则" : id === "generator" ? "发布诊断" : label}</span>{id === "nodes" && <b>{project.config.proxies.length}</b>}</button>)}
          <details className="top-more"><summary aria-label="更多工具" title="更多工具"><MoreHorizontal size={17} /></summary><div>{secondaryNav.map(({ id, label, hint, icon: Icon }) => <button key={id} onClick={() => navigate(id)} title={hint}><Icon size={16} />{label}</button>)}<button onClick={() => navigate("preview")}><FileCode2 size={16} />预览校验</button><button onClick={() => navigate("history")}><History size={16} />历史版本</button>{user.isAdmin && <button onClick={() => navigate("admin")}><ShieldCheck size={16} />用户管理</button>}<button onClick={guide.openCenter}><CircleHelp size={16} />新手教程</button></div></details>
        </nav>
        <div className="save-state" aria-live="polite">{status === "saving" ? <><Save className="spin" size={15} />保存中</> : status === "dirty" ? <><Save size={15} />待保存</> : status === "error" ? <><XCircle size={15} />保存失败</> : <><CheckCircle2 size={15} />已同步</>}</div>
        {status === "error" && <button className="text-button" onClick={() => { statusRef.current = "dirty"; setStatus("dirty"); }}>重试</button>}
        <div className="top-actions">
          <button className="secondary-button top-import-action" onClick={() => setShowImport(true)} aria-label="导入配置" title="导入配置"><Upload size={17} /><span>导入配置</span></button>
          <select className="format-select" value={project.targetFormat} onChange={(event) => updateProject((current) => ({ ...current, targetFormat: event.target.value as TargetFormat }))} aria-label="导出格式"><option value="mihomo">YAML</option><option value="sing-box">JSON</option></select>
          <button className="primary-button" onClick={() => void download()} disabled={errors > 0} aria-label="导出" title="导出当前配置"><Download size={17} /><span>导出</span></button>
        </div>
        <div className="top-user"><span>{user.username.slice(0, 1).toUpperCase()}</span><button className="icon-button compact" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><LogOut size={17} /></button></div>
      </header>
      <div className={`mobile-guide-slot${view === "home" ? " mobile-guide-home" : ""}`}><GuideTrigger controller={guide} className="mobile-guide-trigger" /></div>

      <div className="page-heading">
        <div><div className="eyebrow">{meta.eyebrow}</div><h1>{meta.title}</h1><p>{meta.description}</p></div>
        {view !== "subscription" && view !== "home" && <button className={errors ? "validation-pill error" : issues.length ? "validation-pill warning" : "validation-pill ok"} onClick={() => setShowIssues(!showIssues)}>{errors ? <XCircle size={17} /> : issues.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{errors ? `${errors} 个错误` : issues.length ? `${issues.length} 个提醒` : "配置正常"}</button>}
      </div>

      {tabs.length > 0 && <nav className="section-tabs" aria-label="当前模块">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={16} />{label}</button>)}</nav>}

      {showIssues && view !== "subscription" && <section className="issues-panel" aria-label="配置检查"><header><strong>配置检查</strong><div className="panel-actions"><button className="secondary-button compact-button" disabled={kernelBusy} onClick={() => void kernelValidate()}>{kernelBusy ? <LoaderCircle className="spin" size={15} /> : <TerminalSquare size={15} />}内核实测</button><button className="icon-button compact" onClick={() => setShowIssues(false)} aria-label="关闭"><XCircle size={18} /></button></div></header>{issues.length ? issues.map((issue, index) => <div className={`issue-row ${issue.level}`} key={`${issue.message}-${index}`}>{issue.level === "error" ? <XCircle size={17} /> : <AlertTriangle size={17} />}<span>{issue.message}</span></div>) : <div className="issue-empty"><CheckCircle2 size={18} />未发现问题</div>}{kernelResult && <div className={`kernel-result ${!kernelResult.available ? "warning" : kernelResult.valid ? "success" : "error"}`}><div>{!kernelResult.available ? <AlertTriangle size={17} /> : kernelResult.valid ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<strong>{!kernelResult.available ? "内核不可用" : kernelResult.valid ? "内核检查通过" : "内核检查失败"}</strong></div><pre>{kernelResult.output}</pre></div>}</section>}

      <section className={`content-area${view === "groups" ? " groups-content" : view === "subscription" ? " subscription-content" : ""}`} key={view}>
        {view === "home" && <><SubscriptionHomeView key={project.id} project={project} canPublish={status === "saved"} onReload={reloadCurrentProject} onNavigate={(next) => { if (navigate(next)) guide.pause(); }} onStartGuide={guide.start} onEdit={editSubscription} onCreate={() => { void createProject().then((created) => { if (created) guide.start("quickstart"); }); }} /><details className="advanced-dashboard"><summary>高级配置详情与历史流程</summary><QuickStartView project={project} onNavigate={(target: GuideTarget) => navigate(target)} onDownload={download} onStartGuide={() => guide.start("quickstart")} /></details></>}
        {view === "sources" && <SourceManagerView onProjectReload={reloadCurrentProject} onMessage={setMessage} />}
        {view === "nodes" && <NodePoolView config={project.config} onConfig={(config) => updateProject((current) => ({ ...current, config }))} onProjectReload={reloadCurrentProject} onMessage={setMessage} onOpenSources={() => navigate("sources")} />}
        {view === "groups" && <GroupsView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} nextAction={<button className="secondary-button group-next-action" disabled={status !== "saved"} aria-label="下一步：生成订阅" onClick={openQuickPublish}>生成订阅</button>} />}
        {view === "rules" && <RulesView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "preview" && <>{previewExport(project.config, project.targetFormat).issues.filter((issue) => issue.level === "error").map((issue, index) => <p role="alert" key={index}>{issue.message}</p>)}<SourceView config={project.config} format={project.targetFormat} source={previewExport(project.config, project.targetFormat).content} onApply={(config) => updateProject((current) => ({ ...current, config }))} /></>}
        {view === "history" && <HistoryView key={project.id} project={project} onRestore={(restored) => { if (restored.id !== projectRef.current?.id) return; if (statusRef.current !== "saved" || saveInFlight.current) { setMessage("历史内容已恢复到服务器，当前未保存草稿已保留，请先导出草稿再核对。"); return; } replaceProject(restored); }} onMessage={setMessage} />}
        {view === "generator" && <GeneratorView project={project} onMessage={setMessage} onOpenNodes={() => navigate("nodes")} />}
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
