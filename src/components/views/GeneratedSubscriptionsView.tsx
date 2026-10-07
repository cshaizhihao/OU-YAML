import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, FileCode2, Link2, RefreshCw, Rss, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api } from "../../api";
import type { GeneratedSubscription, GenerationProfile } from "../../shared/domain";
import { ConfirmDialog } from "../Dialog";

export function GeneratedSubscriptionsView({ onMessage }: { onMessage: (value: string) => void }) {
  const [items, setItems] = useState<GeneratedSubscription[]>([]);
  const [profiles, setProfiles] = useState<GenerationProfile[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [revoking, setRevoking] = useState<GeneratedSubscription | null>(null);
  const [deleting, setDeleting] = useState<GeneratedSubscription | null>(null);

  async function load() {
    const [nextItems, nextProfiles] = await Promise.all([api.listGeneratedSubscriptions(), api.listGenerationProfiles()]);
    setItems(nextItems);
    setProfiles(nextProfiles);
  }

  useEffect(() => { void load().catch((error) => onMessage(error instanceof Error ? error.message : "订阅链接加载失败")); }, []);
  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.name])), [profiles]);
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${profileNames.get(item.profileId) || ""} ${item.targetFormat}`.toLowerCase().includes(query.trim().toLowerCase())), [items, profileNames, query]);

  async function rotateAndCopy(item: GeneratedSubscription) {
    setBusyId(item.id);
    try {
      const result = await api.rotateGeneratedSubscriptionToken(item.id);
      setTokens((current) => ({ ...current, [item.id]: result.token }));
      await navigator.clipboard?.writeText(`${window.location.origin}/sub/${result.token}`);
      onMessage("新订阅地址已复制，之前的地址已失效");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "订阅地址重置失败");
    } finally {
      setBusyId("");
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusyId(revoking.id);
    try {
      await api.revokeGeneratedSubscription(revoking.id);
      setItems((current) => current.map((item) => item.id === revoking.id ? { ...item, revoked: true, updatedAt: new Date().toISOString() } : item));
      setTokens((current) => { const next = { ...current }; delete next[revoking.id]; return next; });
      setRevoking(null);
      onMessage("订阅已撤销，公开地址立即失效");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "订阅撤销失败");
    } finally {
      setBusyId("");
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await api.deleteGeneratedSubscription(deleting.id);
      setItems((current) => current.filter((item) => item.id !== deleting.id));
      setTokens((current) => { const next = { ...current }; delete next[deleting.id]; return next; });
      setDeleting(null);
      onMessage("发布记录已删除");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "发布记录删除失败");
    } finally {
      setBusyId("");
    }
  }

  const status = (item: GeneratedSubscription) => {
    if (item.revoked) return { label: "已撤销", className: "danger" };
    if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return { label: "已过期", className: "warning" };
    return { label: "有效", className: "success" };
  };

  return <>
    <div className="view-toolbar published-toolbar">
      <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索订阅或生成方案" /></label>
      <button className="secondary-button" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await load(); } catch (error) { onMessage(error instanceof Error ? error.message : "刷新失败"); } finally { setRefreshing(false); } }}><RefreshCw size={16} className={refreshing ? "spin" : ""} />刷新</button>
    </div>
    <div className="published-overview"><span><strong>{items.length}</strong><small>发布记录</small></span><span><strong>{items.filter((item) => status(item).className === "success").length}</strong><small>有效链接</small></span><span><strong>{new Set(items.map((item) => item.profileId)).size}</strong><small>生成方案</small></span></div>

    {filtered.length ? <div className="subscription-list rich-list">{filtered.map((item) => {
      const token = tokens[item.id];
      const url = token ? `${window.location.origin}/sub/${token}` : "";
      const itemStatus = status(item);
      return <article className={`subscription-row ${itemStatus.className}`} key={item.id}>
        <span className="subscription-icon"><Rss size={20} /></span>
        <div className="subscription-main"><div className="subscription-title"><h2>{item.name}</h2><span className={`type-badge ${itemStatus.className}`}>{itemStatus.label}</span></div><span><FileCode2 size={13} />{profileNames.get(item.profileId) || "生成方案已删除"} · {item.targetFormat === "sing-box" ? "sing-box JSON" : "Mihomo YAML"}</span>{token ? <code>{url}</code> : <small className="token-hint">出于安全考虑，公开地址不在数据库中明文保存</small>}</div>
        <div className="subscription-version"><small>内容版本</small><strong>v{item.version}</strong></div>
        <div className="subscription-stats"><strong>{item.nodeCount}</strong><span>节点</span></div>
        <div className="subscription-meta"><span><CalendarClock size={14} />{item.expiresAt ? `${new Date(item.expiresAt).toLocaleString("zh-CN")} 过期` : "永久有效"}</span><span>更新于 {new Date(item.updatedAt).toLocaleString("zh-CN")}</span></div>
        <div className="row-actions subscription-actions">
          {!item.revoked && <button className="secondary-button compact-button" disabled={busyId === item.id} onClick={() => void rotateAndCopy(item)} title="为安全起见，此操作会让旧地址失效"><Copy size={15} />{token ? "再次重置" : "重置并复制地址"}</button>}
          {token && !item.revoked && <a className="secondary-button compact-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15} />打开</a>}
          {!item.revoked && <button className="icon-button compact danger" onClick={() => setRevoking(item)} aria-label={`撤销 ${item.name}`}><ShieldOff size={16} /></button>}
          <button className="icon-button compact danger" onClick={() => setDeleting(item)} aria-label={`删除 ${item.name}`}><Trash2 size={16} /></button>
        </div>
      </article>;
    })}</div> : <div className="empty-state"><div><Link2 size={24} /></div><h2>{query ? "没有匹配的订阅" : "还没有发布订阅"}</h2><p>{query ? "换个关键词再试试。" : "在“生成方案”中完成校验并发布第一个公开地址。"}</p>{!query && <span className="empty-security-note"><ShieldCheck size={15} />公开 Token 仅在创建或重置时显示</span>}</div>}

    <ConfirmDialog open={!!revoking} title="撤销公开订阅" message={`撤销“${revoking?.name}”后，当前公开地址会立即失效，且不能重新启用。生成方案仍会保留。`} confirmText="确认撤销" onClose={() => setRevoking(null)} onConfirm={revoke} />
    <ConfirmDialog open={!!deleting} title="删除发布记录" message={`确定永久删除“${deleting?.name}”吗？公开地址会立即失效，此操作不可恢复。`} confirmText="确认删除" onClose={() => setDeleting(null)} onConfirm={remove} />
  </>;
}
