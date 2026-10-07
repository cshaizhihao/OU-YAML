import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Copy, FileUp, LoaderCircle, Play, Rocket } from "lucide-react";
import { api } from "../../api";
import type { ManagedNode, GeneratedSubscription } from "../../shared/domain";
import type { Project } from "../../shared/types";
import { copyText } from "../../shared/clipboard";
import { guideTargets } from "../../guides/registry";
import { recommendedConfig, refreshProfileConfig, type QuickPublishInput, type QuickPublishPreview } from "../../shared/publication";
import { sourceErrorAdvice } from "../../shared/subscriptionStatus";

function progress(action: string) { window.dispatchEvent(new CustomEvent("ou-yaml:guide-progress", { detail: action })); }

export function QuickSetupView({ project, initialStep = 0, canPublish = true, onReload, onAdvanced, onStartGuide, onDone }: { project: Project; initialStep?: number; canPublish?: boolean; onReload: () => Promise<void>; onAdvanced: () => void; onStartGuide: () => void; onDone?: () => void }) {
  const [step, setStep] = useState(initialStep);
  const [publicationName, setPublicationName] = useState(project.name);
  const [content, setContent] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [nodeLimit, setNodeLimit] = useState(100);
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(project.config.proxies.map((node) => node.id)));
  const [preset, setPreset] = useState<"balanced" | "simple" | "current">(project.config.proxies.length ? "current" : project.targetFormat === "sing-box" ? "simple" : "balanced");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [includeNewNodes, setIncludeNewNodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [demo, setDemo] = useState(false);
  const [importError, setImportError] = useState("");
  const [review, setReview] = useState<{ input: QuickPublishInput; preview: QuickPublishPreview } | null>(null);
  const [result, setResult] = useState<(GeneratedSubscription & { kernelChecked?: boolean }) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.listManagedNodes(), api.listGenerationProfiles(), api.listGeneratedSubscriptions()]).then(([items, profiles, subscriptions]) => {
      if (cancelled) return;
      const enabled = items.filter((item) => item.enabled);
      setNodes(enabled);
      setSelected(new Set(project.config.proxies.filter((node) => enabled.some((item) => item.id === node.id)).map((node) => node.id)));
      const profile = profiles.filter((item) => item.projectId === project.id && item.targetFormat === project.targetFormat).sort((first, second) => first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id))[0];
      if (profile) { setAutoUpdate(!!profile.autoUpdate); setIncludeNewNodes(!!profile.includeNewNodes); }
      const published = subscriptions.find((item) => item.profileId === profile?.id && !item.revoked && (!item.expiresAt || new Date(item.expiresAt).getTime() > Date.now()));
      if (published) { setResult(published); setPublicationName(published.name); }
      setReady(true);
    }).catch((error) => { if (!cancelled) setMessage(error.message); });
    const navigateStep = (event: Event) => { const requested = Number((event as CustomEvent).detail); if (Number.isInteger(requested) && requested >= 0 && requested <= 2) { setDemo(false); setStep(requested); } };
    window.addEventListener("ou-yaml:quick-step", navigateStep);
    return () => { cancelled = true; window.removeEventListener("ou-yaml:quick-step", navigateStep); };
  }, [project.id]);

  useEffect(() => { setReview(null); }, [selected, preset, autoUpdate, includeNewNodes, project.updatedAt, publicationName]);

  async function checkPublish() {
    if (!ready) return;
    if (!canPublish) { setMessage("请等待配置保存成功，再检查发布"); return; }
    setBusy(true);
    setMessage("");
    setReview(null);
    const input: QuickPublishInput = { name: publicationName.trim(), nodeIds: [...selected], preset, autoUpdate, includeNewNodes, updatedAt: project.updatedAt };
    try { setReview({ input, preview: await api.previewQuickPublish(project.id, input) }); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function prepareManual() {
    if (!ready || !canPublish || busy || !selected.size) return;
    setBusy(true); setMessage("");
    try {
      const chosen = nodes.filter((node) => selected.has(node.id));
      const existing = new Map(project.config.proxies.map((node) => [node.id, node]));
      const config = preset === "current" ? refreshProfileConfig(project.config, chosen.map((node) => existing.get(node.id) || node), true) : recommendedConfig(chosen, preset);
      await api.saveProject({ ...project, name: publicationName.trim() || project.name, config });
      await onReload();
      onAdvanced();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function importContent() {
    setBusy(true);
    setMessage("");
    setImportError("");
    try {
      const remote = /^https?:\/\/\S+$/i.test(content.trim());
      const source = sourceId ? { id: sourceId } : await api.createNodeSource({ name: `快捷导入 ${new Date().toLocaleString("zh-CN")}`, kind: remote ? "remote-url" : /^(vless|vmess|ss|ssr|trojan|hysteria2?|hy2|tuic):\/\//i.test(content.trim()) ? "share-links" : "file", format: "auto", enabled: true, intervalMinutes: remote ? 360 : 0, skipCertVerify: false, ...(remote ? { url: content.trim() } : {}) });
      setSourceId(source.id);
      const imported = remote ? await api.refreshNodeSource(source.id) : await api.importNodeSource(source.id, content);
      if (!imported.nodes.length) throw new Error("未识别到节点，请检查订阅或文件内容");
      const available = (await api.listManagedNodes()).filter((node) => node.enabled);
      setNodes(available);
      setSelected(new Set(imported.nodes.map((node) => node.id)));
      setStep(1);
      setMessage(`已导入 ${imported.nodes.length} 个节点${imported.warnings.length ? `，${imported.warnings.length} 条内容未识别，请在导入节点页查看` : ""}`);
      progress("imported");
    } catch (error) { setImportError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!review || !canPublish || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const published = await api.quickPublish(project.id, { ...review.input, previewRevision: review.preview.revision });
      setResult(published);
      setReview(null);
      setStep(2);
      progress("published");
      await onReload().catch(() => setMessage("订阅已发布，页面状态刷新失败，请重新打开首页查看。"));
    } catch (error) { setMessage((error as Error).message); setReview(null); }
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
      {step === 0 && <div className="quick-body" data-guide-id={guideTargets.quickImport}><label className="import-textarea">订阅 URL、分享链接或配置内容<textarea disabled={busy} value={content} onChange={(event) => { setContent(event.target.value); setSourceId(""); setImportError(""); }} placeholder="https://example.com/subscribe 或 vless://…" /></label><label className="file-picker"><FileUp size={20} />选择配置文件<input type="file" disabled={busy} accept=".yaml,.yml,.json,.txt,.conf" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setMessage("文件不能超过 2MB"); return; } setContent(await file.text()); setSourceId(""); }} /></label><div className="quick-footer"><button className="primary-button" disabled={busy || !content.trim()} onClick={() => void importContent()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}导入并继续</button>{nodes.length > 0 && <button className="secondary-button" disabled={busy} onClick={() => { if (!selected.size) setSelected(new Set(nodes.map((node) => node.id))); setStep(1); progress("imported"); }}>使用已有 {nodes.length} 个节点</button>}</div></div>}
      {step === 1 && <div className="quick-body" inert={busy} data-guide-id={guideTargets.quickConfigure}><h2>选择适合你的配置</h2><label className="editor-name">订阅名称<input value={publicationName} maxLength={120} onChange={(event) => setPublicationName(event.target.value)} placeholder="例如：我的日常订阅" /></label><div className="quick-presets">{[{ id: "balanced" as const, name: "基础分流", hint: "Mihomo · 国内直连、广告拦截、其余代理" }, { id: "simple" as const, name: "简洁代理", hint: "所有流量交给节点选择，兼容更多格式" }, { id: "current" as const, name: "保留当前配置", hint: "沿用你已编辑的分组和规则" }].map((item) => <button key={item.id} disabled={item.id === "balanced" && project.targetFormat === "sing-box"} className={`template-choice${preset === item.id ? " active" : ""}`} onClick={() => setPreset(item.id)}><span><strong>{item.name}</strong><small>{item.hint}</small></span></button>)}</div><details><summary>已选 {selected.size} / {nodes.length} 个节点，点击调整</summary><div className="quick-node-list">{nodes.slice(0, nodeLimit).map((node) => <label key={node.id}><input type="checkbox" checked={selected.has(node.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(node.id) : next.delete(node.id); return next; })} /><span>{node.name}</span></label>)}</div>{nodes.length > nodeLimit && <button className="text-button" onClick={() => setNodeLimit(nodeLimit + 100)}>再显示 100 个节点</button>}</details><label className="toggle-row"><span>来源变化后自动更新原订阅</span><input type="checkbox" checked={autoUpdate} onChange={(event) => setAutoUpdate(event.target.checked)} /></label>{autoUpdate && <label className="toggle-row"><span>同时接收所选来源的新增节点</span><input type="checkbox" checked={includeNewNodes} onChange={(event) => setIncludeNewNodes(event.target.checked)} /></label>}<p className="form-hint">推荐模板会更新当前项目的分组与规则，并自动保留发布前快照。</p><button className="primary-button" disabled={busy || !ready || !selected.size || !canPublish || !publicationName.trim()} onClick={() => void checkPublish()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Rocket size={17} />}{busy ? "正在检查…" : result ? "检查发布变化" : "生成我的订阅"}</button><button className="secondary-button" disabled={busy || !ready || !canPublish || !selected.size} onClick={() => void prepareManual()}>手动编辑分组后再发布</button>{!canPublish && <p role="status">当前配置尚未保存成功，请稍候；若保存失败，请先处理后再发布。</p>}{review && <section className="publish-review" data-guide-id={guideTargets.publishReview} aria-label="发布前确认"><p>订阅名称：{review.input.name}</p><h3>{review.preview.createsNewLink ? "确认创建订阅" : "确认更新原订阅"}</h3><p>{review.preview.createsNewLink ? "将创建新地址，请将新链接添加到客户端。" : `将更新“${review.preview.existingName}”，原地址和有效期保持不变。`}</p><dl>{([["nodes", "节点"], ["groups", "代理组"], ["rules", "分流规则"]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{review.preview.before?.[key] ?? 0} → {review.preview.after[key]}</dd></div>)}</dl><p>{review.preview.contentChanged ? "数量相同也可能有参数或顺序变化。确认后还会执行服务端校验；失败不替换旧内容。" : "公开内容没有变化，不会增加内容版本；只保存配置和同步选项。"}</p><p>来源自动更新：{review.input.autoUpdate ? "开启" : "关闭"} · 接收新增节点：{review.input.includeNewNodes ? "是" : "否"}</p><button className="primary-button" disabled={busy || !canPublish} onClick={() => void publish()}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}确认并发布</button><button className="text-button" disabled={busy} onClick={() => setReview(null)}>返回修改</button></section>}</div>}
      {step === 2 && !result && <div className="quick-body"><h2>还没有发布订阅</h2><p>请先完成节点导入和推荐配置，再生成链接。</p><button className="primary-button" onClick={() => setStep(nodes.length ? 1 : 0)}>返回配置</button></div>}
      {step === 2 && result && <div className="quick-body quick-result" data-guide-id={guideTargets.quickResult}><CheckCircle2 size={32} /><h2>订阅已发布</h2><p>内容版本 v{result?.version} · {result?.nodeCount} 个节点</p>{result?.kernelChecked === false && <p>结构校验已通过，当前服务器未安装内核，未执行内核校验。</p>}{url ? <><code>{url}</code><button className="primary-button" onClick={() => void copyText(url).then(() => { setMessage("订阅链接已复制"); progress("copied"); }).catch((error) => setMessage(error.message))}><Copy size={17} />复制订阅链接</button></> : <button className="primary-button" onClick={() => void recoverLink()}>显示原订阅链接</button>}<ol className="client-instructions"><li>打开支持 {project.targetFormat === "mihomo" ? "Mihomo / Clash" : "sing-box"} 的客户端。</li><li>进入“订阅 / 配置”，选择“从 URL 添加”。</li><li>粘贴链接并更新订阅，选择节点后启用连接。</li></ol><p>后续更新保留原地址。客户端仍需定时或手动刷新订阅。</p>{onDone && <button className="secondary-button" onClick={onDone}>回到我的订阅</button>}</div>}
    </>}
    {importError && <div className="home-recovery" role="alert"><strong>导入未完成，已有订阅未改变</strong><p>{importError}</p><p>{sourceErrorAdvice(importError)}</p><small>可以修改链接后重试，也可到“订阅来源”诊断已保存的来源。</small></div>}
    {message && <p className="quick-message" role="status">{message}</p>}
  </section>;
}
