import { useState } from "react";
import { Boxes, Database, LoaderCircle, Pencil, ScrollText } from "lucide-react";
import { api } from "../api";
import type { GeneratedSubscription } from "../shared/domain";
import type { SubscriptionEditorTab } from "../shared/subscriptionEditor";
import { Drawer } from "./Dialog";

export function SubscriptionActions({ item, onEdit, onRenamed }: { item: GeneratedSubscription; onEdit: (id: string, tab: SubscriptionEditorTab) => void; onRenamed: (item: GeneratedSubscription) => void }) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function rename() {
    if (!name?.trim() || busy) return;
    setBusy(true);
    try { onRenamed(await api.renameSubscription(item.id, name.trim())); setName(null); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="subscription-edit-actions">
      <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "groups")}><Boxes size={16} />编辑分组</button>
      <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "rules")}><ScrollText size={16} />编辑分流</button>
      <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "nodes")}><Database size={16} />选择节点</button>
      <button className="text-button" onClick={() => { setName(item.name); setError(""); }}><Pencil size={15} />重命名</button>
    </div>
    <Drawer title="重命名订阅" open={name !== null} onClose={() => { if (!busy) setName(null); }} footer={<><button className="secondary-button" disabled={busy} onClick={() => setName(null)}>取消</button><button className="primary-button" disabled={busy || !name?.trim()} onClick={() => void rename()}>{busy && <LoaderCircle size={16} className="spin" />}保存名称</button></>}>
      <label className="editor-name">订阅名称<input value={name || ""} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><p>只修改管理界面中的名称，原链接、公开配置和内容版本保持不变。</p>{error && <p role="alert">{error}</p>}
    </Drawer>
  </>;
}
