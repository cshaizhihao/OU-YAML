import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpenCheck, Check, Circle, Database, Download, Gauge, Group, LoaderCircle, Orbit, Play, Rocket, ScrollText, ShieldCheck, UploadCloud } from "lucide-react";
import { api } from "../../api";
import { guideTargets } from "../../guides/registry";
import { validateConfig } from "../../shared/mihomo";
import type { KernelInfo, KernelValidationResult, Project } from "../../shared/types";

export type GuideTarget = "sources" | "nodes" | "groups" | "rules" | "generator" | "settings";

export function QuickStartView({ project, onNavigate, onDownload, onStartGuide }: {
  project: Project;
  onNavigate: (target: GuideTarget) => void;
  onDownload: () => Promise<void>;
  onStartGuide: () => void;
}) {
  const [kernels, setKernels] = useState<KernelInfo[]>([]);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelResult, setKernelResult] = useState<KernelValidationResult | null>(null);
  const [message, setMessage] = useState("");
  const [catalogStats, setCatalogStats] = useState({ sources: 0, nodes: 0 });

  useEffect(() => {
    api.kernelInfo().then(setKernels).catch(() => setKernels([]));
    Promise.all([api.listNodeSources(), api.listManagedNodes()])
      .then(([sources, nodes]) => setCatalogStats({ sources: sources.length, nodes: nodes.length }))
      .catch(() => setCatalogStats({ sources: 0, nodes: 0 }));
  }, []);
  const issues = useMemo(() => validateConfig(project.config), [project.config]);
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const nodeNames = useMemo(() => new Set(project.config.proxies.map((node) => node.name)), [project.config.proxies]);
  const hasSource = catalogStats.sources > 0 || catalogStats.nodes > 0 || project.config.proxies.length > 0;
  const hasNodes = project.config.proxies.length > 0;
  const hasGroups = project.config.proxyGroups.some((group) => group.proxies.some((member) => nodeNames.has(member)));
  const hasRules = project.config.rules.some((rule) => rule.enabled && rule.type === "MATCH");
  const ready = hasNodes && hasGroups && hasRules && errorCount === 0;
  const kernel = kernels.find((item) => item.engine === project.targetFormat);
  const progress = [hasSource, hasNodes, hasGroups, hasRules, ready].filter(Boolean).length;

  async function checkKernel() {
    setKernelBusy(true);
    setKernelResult(null);
    try { setKernelResult(await api.kernelValidate(project.config, project.targetFormat)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "内核检查失败"); }
    finally { setKernelBusy(false); }
  }

  const nextTarget: GuideTarget = ready ? "generator" : !hasSource ? "sources" : !hasNodes ? "nodes" : !hasGroups ? "groups" : !hasRules ? "rules" : "generator";
  const workflow = [
    { number: 1, title: "导入节点", description: hasSource ? `节点库已有 ${catalogStats.nodes || project.config.proxies.length} 个节点` : "粘贴订阅 URL、分享链接或配置文件", complete: hasSource, icon: UploadCloud, action: () => onNavigate("sources" as const), actionLabel: "去导入" },
    { number: 2, title: "选择项目节点", description: hasNodes ? `当前项目已选择 ${project.config.proxies.length} 个节点` : "从节点库挑选真正要生成订阅的节点", complete: hasNodes, icon: Database, action: () => onNavigate("nodes" as const), actionLabel: "选择节点" },
    { number: 3, title: "设置代理方式", description: hasGroups ? `${project.config.proxyGroups.length} 个代理组已引用节点` : "把节点放入选择组，也可以设置自动测速", complete: hasGroups, icon: Group, action: () => onNavigate("groups" as const), actionLabel: "设置代理" },
    { number: 4, title: "设置中文分流", description: hasRules ? `${project.config.rules.length} 条规则，已经包含最终兜底` : "用中文规则决定哪些网站直连或走代理", complete: hasRules, icon: ScrollText, action: () => onNavigate("rules" as const), actionLabel: "设置分流" },
    { number: 5, title: "生成订阅", description: ready ? "配置检查通过，可以发布稳定订阅链接" : errorCount ? `还有 ${errorCount} 个错误需要处理` : "完成前面步骤后即可发布", complete: ready, icon: Rocket, action: () => onNavigate(ready ? "generator" : nextTarget), actionLabel: ready ? "生成订阅" : "继续完善" },
  ];

  return <div className="dashboard-view">
    <section className="dashboard-hero" data-guide-id={guideTargets.homeHero}>
      <div>
        <span className="hero-kicker"><Orbit size={15} />OU-YAML 配置工作台</span>
        <h2>{ready ? "配置已经可以启航" : "五步完成你的第一个订阅"}</h2>
        <p>不需要编写 YAML，按照中文步骤完成导入、选择、代理、分流和发布。</p>
        <div className="hero-actions">
          <button className="primary-button" data-guide-id={guideTargets.homeContinue} onClick={() => onNavigate(nextTarget)}>{ready ? <Rocket size={17} /> : <ArrowRight size={17} />}{ready ? "发布当前配置" : "继续下一步"}</button>
          <button className="secondary-button" onClick={onStartGuide}><Play size={17} />新手教程</button>
          <button className="secondary-button" disabled={errorCount > 0} onClick={() => void onDownload()}><Download size={17} />导出配置</button>
        </div>
      </div>
      <div className="hero-progress" aria-label={`配置进度 ${progress}/5`}>
        <div className="progress-orbit"><strong>{progress}<small>/5</small></strong><span>配置进度</span></div>
        <div className={ready ? "hero-status ready" : "hero-status"}>{ready ? <ShieldCheck size={17} /> : <Gauge size={17} />}{ready ? "结构校验通过" : "继续完善配置"}</div>
      </div>
    </section>

    <section className="metric-grid">
      <article className="metric-card ruby"><span>节点</span><strong>{project.config.proxies.length}</strong><small>{hasNodes ? "已加入当前项目" : "等待选择"}</small></article>
      <article className="metric-card teal"><span>代理组</span><strong>{project.config.proxyGroups.length}</strong><small>{hasGroups ? "代理关系已建立" : "尚未引用节点"}</small></article>
      <article className="metric-card amber"><span>规则</span><strong>{project.config.rules.length}</strong><small>{hasRules ? "包含最终兜底" : "需要最终兜底规则"}</small></article>
      <article className="metric-card plum"><span>检查</span><strong>{errorCount || "✓"}</strong><small>{errorCount ? "个错误待修复" : `${issues.length} 个提醒`}</small></article>
    </section>

    <section className="dashboard-grid">
      <div className="workflow-panel">
        <header><div><span className="eyebrow">五步完成订阅</span><h3>当前项目操作流程</h3></div><span>{project.targetFormat === "sing-box" ? "sing-box JSON" : "Mihomo YAML"}</span></header>
        <div className="workflow-list">{workflow.map(({ number, title, description, complete, icon: Icon, action, actionLabel }) =>
          <article className={complete ? "workflow-item complete" : "workflow-item"} key={title}>
            <span className="workflow-marker">{complete ? <Check size={17} /> : number}</span>
            <span className="workflow-icon"><Icon size={19} /></span>
            <div><strong>{title}</strong><small>{description}</small></div>
            <button className="text-button" onClick={action}>{actionLabel}<ArrowRight size={14} /></button>
          </article>)}</div>
      </div>

      <aside className="health-panel">
        <span className="eyebrow">发布前检查</span>
        <h3>导出前检查</h3>
        <div className="health-list">
          <span><Circle size={12} className={errorCount ? "danger-dot" : "success-dot"} /><div><strong>结构校验</strong><small>{errorCount ? `${errorCount} 个错误` : "已通过"}</small></div></span>
          <span><Circle size={12} className={kernel?.available ? "success-dot" : "warning-dot"} /><div><strong>{project.targetFormat === "sing-box" ? "sing-box" : "Mihomo"} 内核</strong><small>{kernel?.available ? kernel.version : "当前环境未安装"}</small></div></span>
          <span><ScrollText size={15} /><div><strong>最终兜底规则</strong><small>{hasRules ? "已经配置" : "尚未配置"}</small></div></span>
        </div>
        <button className="secondary-button" disabled={kernelBusy || !kernel?.available || errorCount > 0} onClick={() => void checkKernel()}>{kernelBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}运行内核校验</button>
        {kernelResult && <div className={`health-result ${kernelResult.valid ? "success" : "error"}`}>{kernelResult.output}</div>}
        {message && <div className="health-result error">{message}</div>}
      </aside>
    </section>
    <section className="beginner-assurance"><BookOpenCheck size={18} /><span><strong>第一次使用看不懂？</strong>点击“新手教程”，系统会自动跳转页面并高亮下一步需要操作的位置。</span></section>
  </div>;
}
