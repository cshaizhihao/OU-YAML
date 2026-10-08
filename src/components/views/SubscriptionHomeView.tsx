import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CircleHelp, Copy, LoaderCircle, Plus, RefreshCw, Rss, Settings2 } from "lucide-react";
import { api } from "../../api";
import type { GeneratedSubscription, GenerationProfile, NodeSource } from "../../shared/domain";
import type { Project } from "../../shared/types";
import { subscriptionStatus } from "../../shared/subscriptionStatus";
import { copyText } from "../../shared/clipboard";
import { guideTargets, type GuideView } from "../../guides/registry";
import { QuickSetupView } from "./QuickSetupView";
import { SubscriptionActions } from "../SubscriptionActions";
import type { SubscriptionEditorTab } from "../../shared/subscriptionEditor";

type HomeData = { subscriptions: GeneratedSubscription[]; profiles: GenerationProfile[]; sources: NodeSource[] };
const dateLabel = (value?: string) => value ? new Date(value).toLocaleString("zh-CN") : "尚无成功记录";

export function SubscriptionHomeView({ project, canPublish, onReload, onNavigate, onStartGuide, onEdit, onCreate }: { project: Project; canPublish: boolean; onReload: () => Promise<void>; onNavigate: (view: GuideView) => void; onStartGuide: (id: string) => void; onEdit: (id: string, tab: SubscriptionEditorTab) => void; onCreate: () => void }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [mode, setMode] = useState<"auto" | "setup" | "overview">(new URLSearchParams(location.search).has("step") ? "setup" : "auto");
  const [initialStep, setInitialStep] = useState(new URLSearchParams(location.search).get("step") === "1" ? 1 : 0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [subscriptions, profiles, sources] = await Promise.all([api.listGeneratedSubscriptions(), api.listGenerationProfiles(), api.listNodeSources()]);
    return { subscriptions, profiles, sources };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => { if (!cancelled) setData(next); }).catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    const openStep = (event: Event) => {
      const step = Number((event as CustomEvent).detail);
      if (Number.isInteger(step) && step >= 0 && step <= 2) { setInitialStep(step); setMode("setup"); }
    };
    window.addEventListener("ou-yaml:quick-step", openStep);
    const overview = () => { if (window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) setMode("overview"); };
    window.addEventListener("ou-yaml:home-overview", overview);
    return () => { cancelled = true; window.removeEventListener("ou-yaml:quick-step", openStep); window.removeEventListener("ou-yaml:home-overview", overview); };
  }, [load]);

  async function refresh() {
    setBusy("refresh");
    setError("");
    try { setData(await load()); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  async function copy(item: GeneratedSubscription) {
    setBusy(item.id);
    setMessage("");
    try {
      const { token } = await api.getSubscriptionToken(item.id);
      await copyText(`${location.origin}/sub/${token}`);
      setMessage("原订阅链接已复制。到客户端添加或刷新订阅即可，无需重置地址。");
    } catch (reason) { setMessage((reason as Error).message); }
    finally { setBusy(""); }
  }

  async function sync(profile: GenerationProfile) {
    setBusy(profile.id);
    setMessage("");
    try {
      await api.syncProfile(profile.id);
      setData(await load());
      setMessage("已同步节点库中的变化。机场尚未拉取的变化请在来源页刷新；客户端仍需更新订阅。");
    } catch (reason) { setMessage((reason as Error).message); setData(await load().catch(() => data)); }
    finally { setBusy(""); }
  }

  function openSetup(step: number) { setInitialStep(step); setMode("setup"); }
  function returnToOverview() {
    if (!window.dispatchEvent(new Event("ou-yaml:before-navigate", { cancelable: true }))) return;
    setMode("overview");
    window.history.replaceState({}, "", location.pathname);
    void refresh();
  }

  if (!data) return <section className="panel-card" aria-live="polite">{error ? <><p role="alert">订阅加载失败：{error}</p><button className="secondary-button" disabled={!!busy} onClick={() => void refresh()}>重新加载</button></> : <p><LoaderCircle className="spin" size={18} /> 正在读取已发布订阅…</p>}</section>;
  const profiles = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const items = data.subscriptions;
  const showSetup = mode === "setup" || (mode === "auto" && !items.length);

  return <div className="subscription-home">
    <section className="home-tasks" aria-label="常用任务" data-guide-id={guideTargets.homeTasks}>
      <button onClick={onCreate}><Plus size={18} /><span><strong>创建新订阅</strong><small>导入 → 推荐或自定义 → 发布</small></span><ArrowRight size={16} /></button>
      <button onClick={() => onStartGuide("website")}><Settings2 size={18} /><span><strong>让某个网站走指定线路</strong><small>用中文设置并发布分流</small></span><ArrowRight size={16} /></button>
      <button onClick={() => onStartGuide("troubleshoot")}><CircleHelp size={18} /><span><strong>订阅不能用，怎么办？</strong><small>按顺序检查，不必重装</small></span><ArrowRight size={16} /></button>
    </section>
    {showSetup ? <>
      {items.length > 0 && <button className="text-button" onClick={returnToOverview}>返回我的订阅</button>}
      <QuickSetupView project={project} initialStep={initialStep} canPublish={canPublish} onReload={onReload} onAdvanced={() => onNavigate("groups")} onStartGuide={() => onStartGuide("quickstart")} onDone={returnToOverview} />
    </> : <section className="home-subscriptions" data-guide-id={guideTargets.homeSubscriptions}>
      <header className="home-subscriptions-heading"><div><span className="eyebrow">所有已生成订阅都在这里</span><h2>已生成的订阅</h2><p>选择对应卡片编辑节点、分组或分流，确认后更新原地址；不用重新创建订阅。</p></div><button className="secondary-button" disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={16} className={busy === "refresh" ? "spin" : ""} />刷新状态</button></header>
      <div className="home-subscription-grid">{items.map((item) => {
        const profile = profiles.get(item.profileId);
        const status = subscriptionStatus(item, profile, data.sources);
        const sourceErrors = profile ? data.sources.filter((source) => profile.sourceIds.includes(source.id) && source.lastError) : [];
        return <article className="home-subscription-card" key={item.id} aria-label={item.name}>
          <header><span className="subscription-icon"><Rss size={21} /></span><div><h3>{item.name}</h3><small>{item.targetFormat === "mihomo" ? "Mihomo YAML" : "sing-box JSON"} · 内容 v{item.version} · {item.nodeCount} 个节点</small></div><span className={`type-badge ${status.tone}`}>{status.label}</span></header>
          <p className={`subscription-health ${status.tone}`}>{status.detail}</p>
          <dl className="subscription-timeline"><div><dt>公开内容最近更新</dt><dd>{dateLabel(item.updatedAt)}</dd></div><div><dt>节点同步最近成功</dt><dd>{dateLabel(profile?.lastSyncAt)}</dd></div><div><dt>跟随已导入节点</dt><dd>{profile?.autoUpdate ? "自动更新已开启" : "手动更新"}</dd></div></dl>
          {(sourceErrors.length > 0 || profile?.lastSyncError) && <div className="home-recovery" role="status"><strong>下一步：{sourceErrors.length ? "检查来源连接" : "检查配置与节点"}</strong><p>{sourceErrors.length ? `${sourceErrors.map((source) => source.name).join("、")} 拉取失败；已发布内容不会因此被清空。` : profile?.lastSyncError}</p><button className="secondary-button compact-button" onClick={() => onNavigate(sourceErrors.length ? "sources" : "preview")}>{sourceErrors.length ? "去诊断来源" : "去预览校验"}<ArrowRight size={14} /></button></div>}
          <div className="home-subscription-actions"><button className="primary-button" disabled={!!busy || !status.available} onClick={() => void copy(item)}><Copy size={16} />复制订阅链接</button>{profile && <button className="secondary-button" disabled={!!busy || !status.available} onClick={() => void sync(profile)}><RefreshCw size={16} className={busy === profile.id ? "spin" : ""} />同步已导入节点</button>}</div>
          <SubscriptionActions item={item} onEdit={onEdit} onRenamed={(renamed) => setData((current) => current ? { ...current, subscriptions: current.subscriptions.map((value) => value.id === renamed.id ? renamed : value) } : current)} />
        </article>;
      })}</div>
      {!items.length && <p>当前配置还没有发布链接。<button className="text-button" onClick={() => openSetup(0)}>开始三步配置</button></p>}
      <section className="publish-workflow" data-guide-id={guideTargets.homePublish}>
        <h3>已经生成的订阅，还能改吗？</h3><ol><li><strong>找到订阅卡片</strong><span>点击这份订阅的「编辑分组」「编辑分流」或「选择节点」。名称也可以单独修改。</span></li><li><strong>确认更新原订阅</strong><span>编辑完点击「检查并更新原订阅」并确认，不需要重新创建地址。</span></li><li><strong>客户端刷新</strong><span>在手机或电脑的代理客户端更新订阅，即可获取最新内容。</span></li></ol>
      </section>
      {message && <p className="quick-message" role="status">{message}</p>}
    </section>}
    {error && <p role="alert">状态刷新失败：{error}，当前展示上次读取的数据。</p>}
    <button className="text-button" onClick={() => onNavigate("links")}>查看全部订阅与地址管理 <ArrowRight size={15} /></button>
  </div>;
}
