import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Circle, Database, Download, Gauge, Group, LoaderCircle, Orbit, Rocket, ScrollText, ShieldCheck, UploadCloud } from "lucide-react";
import { api } from "../../api";
import { validateConfig } from "../../shared/mihomo";
import type { KernelInfo, KernelValidationResult, Project } from "../../shared/types";

export type GuideTarget = "sources" | "nodes" | "groups" | "rules" | "generator" | "settings";

export function QuickStartView({ project, onNavigate, onDownload }: {
  project: Project;
  onNavigate: (target: GuideTarget) => void;
  onDownload: () => Promise<void>;
}) {
  const [kernels, setKernels] = useState<KernelInfo[]>([]);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelResult, setKernelResult] = useState<KernelValidationResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => { api.kernelInfo().then(setKernels).catch(() => setKernels([])); }, []);
  const issues = useMemo(() => validateConfig(project.config), [project.config]);
  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const nodeNames = useMemo(() => new Set(project.config.proxies.map((node) => node.name)), [project.config.proxies]);
  const hasNodes = project.config.proxies.length > 0;
  const hasGroups = project.config.proxyGroups.some((group) => group.proxies.some((member) => nodeNames.has(member)));
  const hasRules = project.config.rules.some((rule) => rule.enabled && rule.type === "MATCH");
  const ready = hasNodes && hasGroups && hasRules && errorCount === 0;
  const kernel = kernels.find((item) => item.engine === project.targetFormat);
  const progress = [hasNodes, hasGroups, hasRules, ready].filter(Boolean).length;

  async function checkKernel() {
    setKernelBusy(true);
    setKernelResult(null);
    try { setKernelResult(await api.kernelValidate(project.config, project.targetFormat)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "内核检查失败"); }
    finally { setKernelBusy(false); }
  }

  const workflow = [
    { number: 1, title: "建立节点来源", description: hasNodes ? `当前项目已选择 ${project.config.proxies.length} 个节点` : "导入订阅 URL、文件或分享链接", complete: hasNodes, icon: UploadCloud, action: () => onNavigate("sources"), actionLabel: "管理来源" },
    { number: 2, title: "挑选并整理节点", description: hasNodes ? "节点已进入当前配置，可继续调整顺序与标签" : "从节点库选择要用于当前项目的节点", complete: hasNodes, icon: Database, action: () => onNavigate("nodes"), actionLabel: "打开节点库" },
    { number: 3, title: "编排代理分组", description: hasGroups ? `${project.config.proxyGroups.length} 个策略组已引用节点` : "拖入节点或策略组，构建选择、测速与链式代理", complete: hasGroups, icon: Group, action: () => onNavigate("groups"), actionLabel: "配置分组" },
    { number: 4, title: "校验并发布", description: ready ? "配置结构完整，可以生成订阅" : hasRules ? `仍有 ${errorCount} 个错误需要处理` : "补充分流规则并通过配置校验", complete: ready, icon: Rocket, action: () => onNavigate(ready ? "generator" : "rules"), actionLabel: ready ? "生成订阅" : "编辑规则" },
  ];

  return <div className="dashboard-view">
    <section className="dashboard-hero">
      <div>
        <span className="hero-kicker"><Orbit size={15} />OU-YAML CONFIGURATION STUDIO</span>
        <h2>{ready ? "配置已经可以启航" : "把节点整理成真正可用的订阅"}</h2>
        <p>从来源、节点、分组到规则与发布，所有步骤围绕当前项目连续完成。</p>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => onNavigate(ready ? "generator" : !hasNodes ? "sources" : !hasGroups ? "groups" : "rules")}>{ready ? <Rocket size={17} /> : <ArrowRight size={17} />}{ready ? "发布当前配置" : "继续下一步"}</button>
          <button className="secondary-button" disabled={errorCount > 0} onClick={() => void onDownload()}><Download size={17} />导出配置</button>
        </div>
      </div>
      <div className="hero-progress" aria-label={`配置进度 ${progress}/4`}>
        <div className="progress-orbit"><strong>{progress}<small>/4</small></strong><span>配置进度</span></div>
        <div className={ready ? "hero-status ready" : "hero-status"}>{ready ? <ShieldCheck size={17} /> : <Gauge size={17} />}{ready ? "结构校验通过" : "继续完善配置"}</div>
      </div>
    </section>

    <section className="metric-grid">
      <article className="metric-card ruby"><span>节点</span><strong>{project.config.proxies.length}</strong><small>{hasNodes ? "已加入当前项目" : "等待选择"}</small></article>
      <article className="metric-card teal"><span>策略组</span><strong>{project.config.proxyGroups.length}</strong><small>{hasGroups ? "分组关系已建立" : "尚未引用节点"}</small></article>
      <article className="metric-card amber"><span>规则</span><strong>{project.config.rules.length}</strong><small>{hasRules ? "包含兜底规则" : "需要 MATCH 规则"}</small></article>
      <article className="metric-card plum"><span>检查</span><strong>{errorCount || "✓"}</strong><small>{errorCount ? "个错误待修复" : `${issues.length} 个提醒`}</small></article>
    </section>

    <section className="dashboard-grid">
      <div className="workflow-panel">
        <header><div><span className="eyebrow">PROJECT FLOW</span><h3>当前项目工作流</h3></div><span>{project.targetFormat === "sing-box" ? "sing-box JSON" : "Mihomo YAML"}</span></header>
        <div className="workflow-list">{workflow.map(({ number, title, description, complete, icon: Icon, action, actionLabel }) =>
          <article className={complete ? "workflow-item complete" : "workflow-item"} key={title}>
            <span className="workflow-marker">{complete ? <Check size={17} /> : number}</span>
            <span className="workflow-icon"><Icon size={19} /></span>
            <div><strong>{title}</strong><small>{description}</small></div>
            <button className="text-button" onClick={action}>{actionLabel}<ArrowRight size={14} /></button>
          </article>)}</div>
      </div>

      <aside className="health-panel">
        <span className="eyebrow">RUNTIME CHECK</span>
        <h3>导出前检查</h3>
        <div className="health-list">
          <span><Circle size={12} className={errorCount ? "danger-dot" : "success-dot"} /><div><strong>结构校验</strong><small>{errorCount ? `${errorCount} 个错误` : "已通过"}</small></div></span>
          <span><Circle size={12} className={kernel?.available ? "success-dot" : "warning-dot"} /><div><strong>{project.targetFormat === "sing-box" ? "sing-box" : "Mihomo"} 内核</strong><small>{kernel?.available ? kernel.version : "当前环境未安装"}</small></div></span>
          <span><ScrollText size={15} /><div><strong>规则兜底</strong><small>{hasRules ? "已配置 MATCH" : "尚未配置"}</small></div></span>
        </div>
        <button className="secondary-button" disabled={kernelBusy || !kernel?.available || errorCount > 0} onClick={() => void checkKernel()}>{kernelBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}运行内核校验</button>
        {kernelResult && <div className={`health-result ${kernelResult.valid ? "success" : "error"}`}>{kernelResult.output}</div>}
        {message && <div className="health-result error">{message}</div>}
      </aside>
    </section>
  </div>;
}
