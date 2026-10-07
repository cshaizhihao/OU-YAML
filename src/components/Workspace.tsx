import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Rocket, ChevronDown, CircleHelp, Download, FileCode2, FolderPlus, Gauge, Group, History, ListChecks, LoaderCircle, LogOut, Menu, Network, Rss, Save, ScrollText, Settings, ShieldCheck, TerminalSquare, Upload, XCircle } from "lucide-react";
import { api } from "../api";
import { exportMihomoYaml, validateConfig } from "../shared/mihomo";
import { exportSingBoxJson } from "../shared/singbox";
import type { KernelValidationResult, MihomoConfig, Project, ProjectSummary, SessionUser, TargetFormat, ValidationIssue } from "../shared/types";
import { ImportCenter } from "./ImportCenter";
import { NodesView } from "./views/NodesView";
import { GroupsView } from "./views/GroupsView";
import { RulesView } from "./views/RulesView";
import { SettingsView } from "./views/SettingsView";
import { SourceView } from "./views/SourceView";
import { SubscriptionsView } from "./views/SubscriptionsView";
import { HistoryView } from "./views/HistoryView";
import { AdminView } from "./views/AdminView";
import { NodePoolView } from "./views/NodePoolView";
import { SourceManagerView } from "./views/SourceManagerView";
import { GeneratedSubscriptionsView } from "./views/GeneratedSubscriptionsView";
import { GeneratorView } from "./views/GeneratorView";
import { TemplatesView } from "./views/TemplatesView";
import { QuickStartView, type GuideTarget } from "./views/QuickStartView";

type View = "start" | "links" | "sources" | "pool" | "generator" | "templates" | "nodes" | "groups" | "rules" | "subscriptions" | "history" | "settings" | "source" | "admin";
const baseNav: { id: View; label: string; hint: string; section: string; icon: typeof Network }[] = [
  { id: "start", label: "开始使用", hint: "新手引导", section: "工作流", icon: ListChecks },
  { id: "sources", label: "导入来源", hint: "订阅 URL / 文件", section: "工作流", icon: FolderPlus },
  { id: "pool", label: "节点池", hint: "管理全部资源节点", section: "工作流", icon: Database },
  { id: "groups", label: "代理分组", hint: "拖拽编排策略", section: "工作流", icon: Group },
  { id: "rules", label: "规则编辑", hint: "匹配与分流", section: "工作流", icon: ScrollText },
  { id: "generator", label: "生成订阅", hint: "生成配置", section: "发布", icon: Rocket },
  { id: "links", label: "发布链接", hint: "查看已发布订阅", section: "发布", icon: Rss },
  { id: "templates", label: "规则模板", hint: "复用模板", section: "资源", icon: FileCode2 },
  { id: "nodes", label: "当前配置节点", hint: "仅当前项目", section: "资源", icon: Network },
  { id: "subscriptions", label: "项目订阅", hint: "自动刷新", section: "资源", icon: Rss },
  { id: "history", label: "历史版本", hint: "回滚快照", section: "管理", icon: History },
  { id: "settings", label: "设置", hint: "账号与系统", section: "管理", icon: Settings },
  { id: "source", label: "查看源码", hint: "原始配置", section: "管理", icon: FileCode2 },
];

export function Workspace({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<View>("start");
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

  const loadProjects = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    if (list.length) setProject(await api.getProject(list[0].id));
    else {
      const created = await api.createProject("我的 Mihomo 配置");
      setProjects([created]); setProject(created);
    }
  }, []);
  useEffect(() => { loadProjects().catch((error) => setMessage(error.message)); }, [loadProjects]);

  const issues = useMemo(() => project ? validateConfig(project.config) : [], [project]);
  const errors = issues.filter((issue) => issue.level === "error").length;
  const nav = useMemo(() => user.isAdmin ? [...baseNav, { id: "admin" as View, label: "系统管理", hint: "用户与权限", section: "管理", icon: ShieldCheck }] : baseNav, [user.isAdmin]);

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
      if (saveInFlight.current) return;
      setStatus("saving");
      const operation = (async () => {
        const saved = await api.saveProject(snapshot);
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
      }
      finally { if (saveInFlight.current === operation) saveInFlight.current = null; }
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
  }, [project, status]);

  async function chooseProject(id: string) {
    if (id === project?.id) return;
    if (status !== "saved") {
      setMessage("当前项目还有未完成的保存，请稍候再切换");
      return;
    }
    setProject(await api.getProject(id)); setStatus("saved");
  }

  async function createProject() {
    const created = await api.createProject("新配置");
    setProjects((current) => [created, ...current]); setProject(created); setView("nodes");
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
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name || "config"}.${project.targetFormat === "sing-box" ? "json" : "yaml"}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) {
      const value = error as Error & { issues?: ValidationIssue[] };
      setMessage(value.message); if (value.issues) setShowIssues(true);
    }
  }

  async function kernelValidate() {
    if (!project) return; setKernelBusy(true); setKernelResult(null);
    try { setKernelResult(await api.kernelValidate(project.config, project.targetFormat)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "内核检查失败"); }
    finally { setKernelBusy(false); }
  }

  if (!project) return <div className="app-loading"><Gauge className="spin" size={24} /><span>正在打开工作台</span></div>;
  const active = nav.find((item) => item.id === view)!;

  return <div className="workspace">
    <aside className={mobileNav ? "sidebar mobile-open" : "sidebar"}>
      <div className="sidebar-brand"><div className="brand-mark"><img src="/brand/ou-yaml-logo.png" alt="OU-YAML" /></div><strong>OU-YAML</strong><button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="关闭导航"><XCircle size={20} /></button></div>
      <nav aria-label="主要导航">{nav.map(({ id, label, hint, section, icon: Icon }, index) => <div key={id}>{(index === 0 || nav[index - 1].section !== section) && <div className="nav-section-label">{section}</div>}<button className={view === id ? "nav-item active" : "nav-item"} onClick={() => { setView(id); setMobileNav(false); }}><Icon size={18} /><span><strong>{label}</strong><small>{hint}</small></span>{id === "nodes" && <b>{project.config.proxies.length}</b>}{id === "groups" && <b>{project.config.proxyGroups.length}</b>}{id === "rules" && <b>{project.config.rules.length}</b>}</button></div>)}</nav>
      <div className="sidebar-foot"><div className="user-chip"><span>{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.isAdmin ? "管理员" : "用户"}</small></div></div><button className="icon-button" title="退出登录" aria-label="退出登录" onClick={async () => { await api.logout(); onLogout(); }}><LogOut size={18} /></button></div>
    </aside>
    {mobileNav && <button className="mobile-nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航菜单" />}

    <main className="main-shell">
      <header className="topbar">
        <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={20} /></button>
        <div className="project-select-wrap"><select aria-label="当前配置" value={project.id} onChange={(e) => chooseProject(e.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></div>
        <button className="icon-button" onClick={createProject} title="新建配置" aria-label="新建配置"><FolderPlus size={18} /></button>
        <div className="save-state" aria-live="polite">{status === "saving" ? <><Save className="spin" size={15} />保存中</> : status === "error" ? <><XCircle size={15} />保存失败</> : <><CheckCircle2 size={15} />已保存</>}</div>
        <div className="top-actions">
          <button className="icon-button guide-button" onClick={() => setView("start")} title="打开新手流程" aria-label="打开新手流程"><CircleHelp size={19} /></button>
          <button className="secondary-button" onClick={() => setShowImport(true)}><Upload size={17} /><span>导入</span></button>
          <select className="format-select" value={project.targetFormat} onChange={(event) => updateProject((current) => ({ ...current, targetFormat: event.target.value as TargetFormat }))} aria-label="导出格式"><option value="mihomo">YAML</option><option value="sing-box">JSON</option></select>
          <button className="primary-button" onClick={download} disabled={errors > 0}><Download size={17} /><span>导出</span></button>
        </div>
      </header>

      <div className="page-heading"><div><div className="eyebrow">{view === "admin" ? "OU-YAML / ADMIN" : view === "start" ? "OU-YAML / QUICK START" : `${project.targetFormat.toUpperCase()} / ${project.config.mode.toUpperCase()}`}</div><h1>{active.label}</h1></div><button className={errors ? "validation-pill error" : issues.length ? "validation-pill warning" : "validation-pill ok"} onClick={() => setShowIssues(!showIssues)}>{errors ? <XCircle size={17} /> : issues.length ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}{errors ? `${errors} 个错误` : issues.length ? `${issues.length} 个提醒` : "配置正常"}</button></div>

      {showIssues && <section className="issues-panel" aria-label="配置检查"><header><strong>配置检查</strong><div className="panel-actions"><button className="secondary-button compact-button" disabled={kernelBusy} onClick={kernelValidate}>{kernelBusy ? <LoaderCircle className="spin" size={15} /> : <TerminalSquare size={15} />}内核实测</button><button className="icon-button compact" onClick={() => setShowIssues(false)} aria-label="关闭"><XCircle size={18} /></button></div></header>{issues.length ? issues.map((issue, index) => <div className={`issue-row ${issue.level}`} key={`${issue.message}-${index}`}>{issue.level === "error" ? <XCircle size={17} /> : <AlertTriangle size={17} />}<span>{issue.message}</span></div>) : <div className="issue-empty"><CheckCircle2 size={18} />未发现问题</div>}{kernelResult && <div className={`kernel-result ${!kernelResult.available ? "warning" : kernelResult.valid ? "success" : "error"}`}><div>{!kernelResult.available ? <AlertTriangle size={17} /> : kernelResult.valid ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<strong>{!kernelResult.available ? "内核不可用" : kernelResult.valid ? "内核检查通过" : "内核检查失败"}</strong></div><pre>{kernelResult.output}</pre></div>}</section>}

      <section className="content-area">
        {view === "start" && <QuickStartView project={project} onConfig={(config, updatedAt) => { setProject((current) => current ? { ...current, config, updatedAt: updatedAt || current.updatedAt } : current); setStatus("saved"); }} onNavigate={(target: GuideTarget) => setView(target)} onOpenImport={() => setShowImport(true)} onDownload={download} />}
        {view === "links" && <GeneratedSubscriptionsView onMessage={setMessage} />}
        {view === "sources" && <SourceManagerView onMessage={setMessage} />}
        {view === "pool" && <NodePoolView config={project.config} onConfig={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} />}
        {view === "generator" && <GeneratorView project={project} onMessage={setMessage} />}
        {view === "templates" && <TemplatesView onMessage={setMessage} />}
        {view === "nodes" && <NodesView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} />}
        {view === "groups" && <GroupsView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} onMessage={setMessage} />}
        {view === "rules" && <RulesView config={project.config} onChange={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "subscriptions" && <SubscriptionsView project={project} onConfig={(config, updatedAt) => { setProject((current) => current ? { ...current, config, updatedAt: updatedAt || current.updatedAt } : current); setStatus("saved"); }} onMessage={setMessage} />}
        {view === "history" && <HistoryView project={project} onRestore={(restored) => { setProject(restored); setStatus("saved"); }} onMessage={setMessage} />}
        {view === "settings" && <SettingsView project={project} isAdmin={user.isAdmin} onChange={updateProject} onReload={loadProjects} onMessage={setMessage} />}
        {view === "source" && <SourceView config={project.config} format={project.targetFormat} source={project.targetFormat === "sing-box" ? exportSingBoxJson(project.config) : exportMihomoYaml(project.config)} onApply={(config) => updateProject((current) => ({ ...current, config }))} />}
        {view === "admin" && user.isAdmin && <AdminView currentUser={user} onMessage={setMessage} />}
      </section>
      <ImportCenter open={showImport} onClose={() => setShowImport(false)} onImport={importContent} />
      {message && <div className="toast" role="status"><CircleHelp size={18} /><span>{message}</span><button className="icon-button compact" onClick={() => setMessage("")} aria-label="关闭"><XCircle size={17} /></button></div>}
    </main>
  </div>;
}
