import { useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, RefreshCw, Rss, ShieldOff } from "lucide-react";
import { api } from "../../api";
import type { GeneratedSubscription } from "../../shared/domain";

export function GeneratedSubscriptionsView({ onMessage }: { onMessage: (value: string) => void }) {
  const [items, setItems] = useState<GeneratedSubscription[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = () => api.listGeneratedSubscriptions().then(setItems).catch(error => onMessage(error instanceof Error ? error.message : "订阅链接加载失败"));
  useEffect(() => { load(); }, []);
  async function revoke(item: GeneratedSubscription) { await api.revokeGeneratedSubscription(item.id); setItems(current => current.map(value => value.id === item.id ? { ...value, revoked: true } : value)); onMessage("订阅已撤销"); }
  async function copy(item: GeneratedSubscription) { const token = tokens[item.id] || (await api.rotateGeneratedSubscriptionToken(item.id)).token; setTokens(current => ({ ...current, [item.id]: token })); await navigator.clipboard?.writeText(`${window.location.origin}/sub/${token}`); onMessage("订阅链接已复制；旧链接已失效"); }
  return <>
    <div className="view-toolbar"><div><div className="summary-inline"><span><strong>{items.length}</strong> 个已发布订阅</span><i/><span><strong>{items.filter(item => !item.revoked).length}</strong> 个有效链接</span></div></div><button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); await load(); setBusy(false); }}><RefreshCw size={16} className={busy ? "spin" : ""}/>刷新</button></div>
    {items.length ? <div className="subscription-list">{items.map(item => { const token = tokens[item.id]; const url = token ? `${window.location.origin}/sub/${token}` : ""; return <article className="subscription-row" key={item.id}><span className="subscription-icon"><Rss size={20}/></span><div className="subscription-main"><h2>{item.name}</h2><span>{item.targetFormat === "sing-box" ? "sing-box JSON" : "Mihomo YAML"} · v{item.version}</span><code>{token ? url : "公开地址仅在生成时显示"}</code></div><span className={item.revoked ? "type-badge danger" : "type-badge success"}>{item.revoked ? "已撤销" : "有效"}</span><div className="subscription-stats"><strong>{item.nodeCount}</strong><span>节点</span></div><div className="row-actions"><button className="secondary-button compact-button" disabled={item.revoked} onClick={() => void copy(item)}><Copy size={15}/>{token ? "复制" : "生成链接"}</button>{token && <a className="secondary-button compact-button" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>打开</a>}{item.revoked ? <ShieldOff size={16}/> : <><CheckCircle2 size={16} className="status-icon success"/><button className="icon-button compact danger" onClick={() => revoke(item)} aria-label="撤销订阅"><ShieldOff size={16}/></button></>}</div></article>; })}</div> : <div className="empty-state"><div><Link2 size={24}/></div><h2>还没有发布订阅</h2><p>完成生成配置后，发布第一个可分享的订阅链接。</p></div>}
  </>;
}
