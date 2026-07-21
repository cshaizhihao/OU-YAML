import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Check, CheckCircle2, Circle, Download, FileUp, Group, Link2, LoaderCircle, Network, ScrollText, ShieldCheck } from "lucide-react";
import { api } from "../../api";
import { validateConfig } from "../../shared/mihomo";
import type { KernelInfo, KernelValidationResult, MihomoConfig, Project, Subscription } from "../../shared/types";

export type GuideTarget = "nodes" | "groups" | "rules" | "subscriptions";

export function QuickStartView({ project, onConfig, onNavigate, onOpenImport, onDownload }: {
  project: Project;
  onConfig: (config: MihomoConfig) => void;
  onNavigate: (target: GuideTarget) => void;
  onOpenImport: () => void;
  onDownload: () => Promise<void>;
}) {
  const [name, setName] = useState("我的订阅");
  const [url, setUrl] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(360);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [kernels, setKernels] = useState<KernelInfo[]>([]);
  const [kernelBusy, setKernelBusy] = useState(false);
  const [kernelResult, setKernelResult] = useState<KernelValidationResult | null>(null);

  useEffect(() => { api.kernelInfo().then(setKernels).catch(() => setKernels([])); }, []);
  const nodeNames = useMemo(() => new Set(project.config.proxies.map((node) => node.name)), [project.config.proxies]);
  const nodesReady = project.config.proxies.length > 0;
  const groupsReady = project.config.proxyGroups.some((group) => group.proxies.some((member) => nodeNames.has(member)));
  const rulesReady = project.config.rules.some((rule) => rule.enabled && rule.type === "MATCH");
  const issues = validateConfig(project.config);
  const errors = issues.filter((issue) => issue.level === "error").length;
  const kernel = kernels.find((item) => item.engine === project.targetFormat);
  const completed = [nodesReady, groupsReady, rulesReady, !errors && !!kernel?.available].filter(Boolean).length;

  async function addSubscription(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const data: Omit<Subscription, "id" | "projectId" | "lastUpdatedAt" | "lastError" | "nodeCount" | "createdAt"> = { name: name.trim() || "我的订阅", url: url.trim(), format: "auto", intervalMinutes };
      const result = await api.createSubscription(project.id, data);
      const payload = "subscription" in result ? result : { subscription: result };
      if (payload.config) onConfig(payload.config);
      setMessage(payload.error || `已导入 ${payload.subscription.nodeCount} 个节点`);
      if (!payload.error) setUrl("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "订阅导入失败"); }
    finally { setBusy(false); }
  }

  async function checkKernel() {
    setKernelBusy(true); setKernelResult(null);
    try { setKernelResult(await api.kernelValidate(project.config, project.targetFormat)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "内核检查失败"); }
    finally { setKernelBusy(false); }
  }

  return <div className="quick-start">
    <header className="quick-start-header"><div><span>首次配置</span><h2>从订阅到可用配置</h2></div><div className="guide-progress"><strong>{completed}/4</strong><span>已完成</span></div></header>

    <section className={nodesReady ? "guide-step complete" : "guide-step active"}>
      <div className="guide-marker">{nodesReady ? <Check size={17} /> : <span>1</span>}</div>
      <div className="guide-step-main"><div className="guide-step-title"><div><h3>导入节点</h3><p>{nodesReady ? `当前配置已有 ${project.config.proxies.length} 个节点` : "填写服务商提供的订阅 URL"}</p></div><span className={nodesReady ? "guide-state done" : "guide-state current"}>{nodesReady ? "已完成" : "当前步骤"}</span></div>
        <form className="subscription-entry" onSubmit={addSubscription}><label>订阅名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="subscription-url-field">订阅 URL<input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/subscription" /></label><label>自动更新<select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}><option value={0}>手动</option><option value={60}>每小时</option><option value={360}>每 6 小时</option><option value={720}>每 12 小时</option><option value={1440}>每天</option></select></label><button className="primary-button" disabled={busy || !url.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}保存并拉取</button></form>
        <div className="guide-alternatives"><button className="secondary-button" onClick={onOpenImport}><FileUp size={16} />导入文件或分享链接</button><button className="text-button" onClick={() => onNavigate("subscriptions")}>管理已有订阅</button></div>{message && <div className="guide-message" role="status">{message}</div>}
      </div>
    </section>

    <GuideStep number={2} title="拖动节点完成分组" detail={groupsReady ? `${project.config.proxyGroups.length} 个策略组已引用节点` : "从节点池拖入策略组，也可多选批量加入"} complete={groupsReady} actions={<><button className="secondary-button" onClick={() => onNavigate("nodes")}><Network size={16} />查看节点</button><button className="secondary-button" onClick={() => onNavigate("groups")}><Group size={16} />打开分组编排</button></>} />
    <GuideStep number={3} title="选择分流规则" detail={rulesReady ? `${project.config.rules.length} 条规则，已包含兜底规则` : "选择规则模板并指定目标策略组"} complete={rulesReady} actions={<button className="secondary-button" onClick={() => onNavigate("rules")}><ScrollText size={16} />打开规则</button>} />
    <GuideStep number={4} title="内核检查与导出" detail={kernel?.available ? kernel.version : `${project.targetFormat} 内核未安装`} complete={!errors && !!kernel?.available} actions={<><button className="secondary-button" disabled={kernelBusy || !kernel?.available} onClick={checkKernel}>{kernelBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}内核检查</button><button className="primary-button" disabled={errors > 0} onClick={onDownload}><Download size={16} />导出配置</button></>} result={kernelResult} />
  </div>;
}

function GuideStep({ number, title, detail, complete, actions, result }: { number: number; title: string; detail: string; complete: boolean; actions: ReactNode; result?: KernelValidationResult | null }) {
  return <section className={complete ? "guide-step complete" : "guide-step"}><div className="guide-marker">{complete ? <Check size={17} /> : <span>{number}</span>}</div><div className="guide-step-main"><div className="guide-step-title"><div><h3>{title}</h3><p>{detail}</p></div>{complete ? <span className="guide-state done">已就绪</span> : <span className="guide-state">待完成</span>}</div><div className="guide-step-actions">{actions}</div>{result && <div className={`guide-check-result ${result.available && result.valid ? "success" : "error"}`}>{result.available && result.valid ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{result.output}</span></div>}</div></section>;
}
