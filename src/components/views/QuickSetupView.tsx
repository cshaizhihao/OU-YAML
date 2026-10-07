import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Copy, FileUp, LoaderCircle, Play, Rocket } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode, GeneratedSubscription } from "../../shared/domain";
import type { Project } from "../../shared/types";
import { copyText } from "../../shared/clipboard";
import { guideTargets } from "../../guides/registry";

function progress(action: string) { window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: action })); }

export function QuickSetupView({ project, onReload, onAdvanced, onStartGuide }: { project: Project; onReload: () => Promise<void>; onAdvanced: () => void; onStartGuide: () => void }) {
  const [step, setStep] = useState(0);
  const [content, setContent] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [nodeLimit, setNodeLimit] = useState(100);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(project.config.proxies.map((node) => node.id)));
  const [preset, setPreset] = useState<"balanced" | "simple" | "current">(project.config.proxies.length ? "current" : project.targetFormat === "sing-box" ? "simple" : "balanced");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [includeNewNodes, setIncludeNewNodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [demo, setDemo] = useState(false);
  const [result, setResult] = useState<(GeneratedSubscription & { kernelChecked?: boolean }) | null>(null);

  useEffect(() => {
    void api.listManagedNodes().then((items) => { setNodes(items.filter((item) => item.enabled)); }).catch((error) => setMessage(error.message));
    void Promise.all([api.listGenerationProfiles(), api.listGeneratedSubscriptions()]).then(([profiles, subscriptions]) => {
      const ids = new Set(profiles.filter((profile) => profile.projectId === project.id).map((profile) => profile.id));
      const published = subscriptions.find((item) => ids.has(item.profileId) && !item.revoked && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()));
      if (published) setResult(published);
    }).catch(() => undefined);
    const navigateStep = (event: Event) => { const requested = Number((event as CustomEvent).detail); if (Number.isInteger(requested) && requested >= 0 && requested <= 2) setStep(requested); };
    window.addEventListener("ou-yaml:quick-step", navigateStep);
    return () => window.removeEventListener("ou-yaml:quick-step", navigateStep);
  }, [project.id]);

  async function importContent() {
    setBusy(true);
    setMessage("");
    try {
      const remote = /^https?:\/\/\S+$/i.test(content.trim());
      const source = sourceId ? { id: sourceId } : await api.createNodeSource({ name: `快捷导入 ${new Date().toLocaleString("zh-CN")}`, kind: remote ? "remote-url" : "file", format: "auto", enabled: true, intervalMinutes: remote ? 360 : 0, skipCertVerify: false, ...(remote ? { url: content.trim() } : {}) });
      setSourceId(source.id);
      const imported = remote ? await api.refreshNodeSource(source.id) : await api.importNodeSource(source.id, content);
      if (!imported.nodes.length) throw new Error("未识别到节点，请检查订阅或文件内容");
      const available = (await api.listManagedNodes()).filter((node) => node.enabled);
      setNodes(available);
      setSelected(new Set(imported.nodes.map((node) => node.id)));
      setStep(1);
      setMessage(`已导入 ${imported.nodes.length} 个节点${imported.warnings.length ? `，${imported.warnings.length} 条内容未识别，请在导入节点页查看` : ""}`);
      progress("imported");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true);
    setMessage("");
    try {
      const published = await api.quickPublish(project.id, { nodeIds: [...selected], preset, autoUpdate, includeNewNodes, updatedAt: project.updatedAt });
      setResult(published);
      await onReload();
      setStep(2);
      progress("published");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function recoverLink() {
    if (!result) return;
    try { const { token } = await api.getSubscriptionToken(result.id); setResult({ ...result, token }); }
    catch (error) { setMessage((error as Error).message); }
  }

  const url = result?.token ? `${location.origin}/sub/${result.token}` : "";
  return <section className="quick-setup" data-guide-id={guideTargets.quickSetup}>
    <header className="quick-hero"><div><span className="eyebrow">从导入到可用订阅</span><h1>三步，准备好你的连接</h1><p>默认帮你设置代理组和分流，需要时再进入高级配置。</p></div><div className="row-actions"><button className="secondary-button" onClick={onStartGuide}><Play size={16} />带我操作</button><button className="text-button" onClick={() => { setDemo(!demo); setStep(0); setMessage(""); }}>{demo ? "退出演示" : "先看演示"}</button></div></header>
    <nav className="quick-steps" aria-label="快捷配置步骤">{["导入订阅", "选择推荐配置", "获取链接"].map((label, index) => <button key={label} className={step === index ? "active" : ""} disabled={busy || (!demo && index === 1 && !nodes.length) || (!demo && index === 2 && !result)} onClick={() => setStep(index)}><b>{index + 1}</b>{label}</button>)}</nav>
    {demo ? <div className="quick-body"><span className="type-badge">演示数据 · 不会保存或发布</span><h2>{["粘贴你的订阅或节点链接", "使用推荐设置", "复制链接到客户端"][step]}</h2><p>{["支持机场订阅 URL、VLESS / VMess / SS 链接，以及 YAML / JSON 配置文件。", "默认建立“节点选择”代理组。基础分流适合 Mihomo，简洁代理适合跨格式使用。", "真实发布后，复制链接到客户端的“添加订阅”，随后点击更新订阅。后续可以保持同一地址更新内容。"][step]}</p><button className="primary-button" onClick={() => step < 2 ? setStep(step + 1) : (setDemo(false), setStep(0))}>{step < 2 ? "继续演示" : "开始真实配置"}<ArrowRight size={16} /></button></div> : <>
      {step === 0 && <div className="quick-body" data-guide-id={guideTargets.quickImport}><label className="import-textarea">订阅 URL、分享链接或配置内容<textarea value={content} onChange={(event) => { setContent(event.target.value); setSourceId(""); }} placeholder="https://example.com/subscribe 或 vless://…" /></label><label className="file-picker"><FileUp size={20} />选择配置文件<input type="file" accept=".yaml,.yml,.json,.txt,.conf" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setMessage("文件不能超过 2MB"); return; } setContent(await file.text()); setSourceId(""); }} /></label><div className="quick-footer"><button className="primary-button" disabled={busy || !content.trim()} onClick={() => void importContent()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}导入并继续</button>{nodes.length > 0 && <button className="secondary-button" onClick={() => { if (!selected.size) setSelected(new Set(nodes.map((node) => node.id))); setStep(1); progress("imported"); }}>使用已有 {nodes.length} 个节点</button>}</div></div>}
      {step === 1 && <div className="quick-body" data-guide-id={guideTargets.quickConfigure}><h2>选择适合你的配置</h2><div className="quick-presets">{[{ id: "balanced" as const, name: "基础分流", hint: "Mihomo · 国内直连、广告拦截、其余代理" }, { id: "simple" as const, name: "简洁代理", hint: "所有流量交给节点选择，兼容更多格式" }, { id: "current" as const, name: "保留当前配置", hint: "沿用你已编辑的分组和规则" }].map((item) => <button key={item.id} disabled={item.id === "balanced" && project.targetFormat === "sing-box"} className={`template-choice${preset === item.id ? " active" : ""}`} onClick={() => setPreset(item.id)}><span><strong>{item.name}</strong><small>{item.hint}</small></span></button>)}</div><details><summary>已选 {selected.size} / {nodes.length} 个节点，点击调整</summary><div className="quick-node-list">{nodes.slice(0, nodeLimit).map((node) => <label key={node.id}><input type="checkbox" checked={selected.has(node.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(node.id) : next.delete(node.id); return next; })} /><span>{node.name}</span></label>)}</div>{nodes.length > nodeLimit && <button className="text-button" onClick={() => setNodeLimit(nodeLimit + 100)}>再显示 100 个节点</button>}</details><label className="toggle-row"><span>来源变化后自动更新原订阅</span><input type="checkbox" checked={autoUpdate} onChange={(event) => setAutoUpdate(event.target.checked)} /></label>{autoUpdate && <label className="toggle-row"><span>同时接收所选来源的新增节点</span><input type="checkbox" checked={includeNewNodes} onChange={(event) => setIncludeNewNodes(event.target.checked)} /></label>}<p className="form-hint">推荐模板会更新当前项目的分组与规则，并自动保留发布前快照。</p><button className="primary-button" disabled={busy || !selected.size} onClick={() => void publish()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Rocket size={17} />}{busy ? "正在校验并发布…" : "生成我的订阅"}</button><button className="text-button" onClick={onAdvanced}>先检查高级配置</button></div>}
      {step === 2 && !result && <div className="quick-body"><h2>还没有发布订阅</h2><p>请先完成节点导入和推荐配置，再生成链接。</p><button className="primary-button" onClick={() => setStep(nodes.length ? 1 : 0)}>返回配置</button></div>}
      {step === 2 && result && <div className="quick-body quick-result" data-guide-id={guideTargets.quickResult}><CheckCircle2 size={32} /><h2>订阅已发布</h2><p>内容版本 v{result?.version} · {result?.nodeCount} 个节点</p>{result?.kernelChecked === false && <p>结构校验已通过，当前服务器未安装内核，未执行内核校验。</p>}{url ? <><code>{url}</code><button className="primary-button" onClick={() => void copyText(url).then(() => { setMessage("订阅链接已复制"); progress("copied"); }).catch((error) => setMessage(error.message))}><Copy size={17} />复制订阅链接</button></> : <button className="primary-button" onClick={() => void recoverLink()}>显示原订阅链接</button>}<ol className="client-instructions"><li>打开支持 {project.targetFormat === "mihomo" ? "Mihomo / Clash" : "sing-box"} 的客户端。</li><li>进入“订阅 / 配置”，选择“从 URL 添加”。</li><li>粘贴链接并更新订阅，选择节点后启用连接。</li></ol><p>后续更新保留原地址。客户端仍需定时或手动刷新订阅。</p></div>}
    </>}
    {message && <p className="quick-message" role="status">{message}</p>}
  </section>;
}
