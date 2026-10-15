import { useState } from "react";
import { Boxes, Database, LoaderCircle, Pencil, ScrollText, Trash2 } from "lucide-react";
import { api } from "../api";
import type { GeneratedSubscription } from "../shared/domain";
import type { SubscriptionEditorTab } from "../shared/subscriptionEditor";
import { Modal, ConfirmDialog } from "./Dialog";

export function SubscriptionActions({
  item,
  onEdit,
  onRenamed,
  onDeleted,
}: {
  item: GeneratedSubscription;
  onEdit: (id: string, tab: SubscriptionEditorTab) => void;
  onRenamed: (item: GeneratedSubscription) => void;
  onDeleted?: (id: string) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function rename() {
    if (!name?.trim() || busy) return;
    setBusy(true);
    try {
      onRenamed(await api.renameSubscription(item.id, name.trim()));
      setName(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await api.deleteGeneratedSubscription(item.id);
      onDeleted?.(item.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="subscription-edit-actions" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
        <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "groups")}>
          <Boxes size={15} />编辑分组
        </button>
        <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "rules")}>
          <ScrollText size={15} />编辑分流
        </button>
        <button className="secondary-button compact-button" disabled={item.revoked} onClick={() => onEdit(item.id, "nodes")}>
          <Database size={15} />选择节点
        </button>
        <button className="text-button" onClick={() => { setName(item.name); setError(""); }}>
          <Pencil size={14} />重命名
        </button>
        <button
          className="secondary-button compact-button danger-outline"
          style={{ marginLeft: "auto" }}
          onClick={() => setDeleting(true)}
          title="删除此订阅链接"
        >
          <Trash2 size={14} />删除订阅
        </button>
      </div>

      <Modal
        size="compact"
        title="重命名订阅"
        open={name !== null}
        onClose={() => { if (!busy) setName(null); }}
        footer={
          <>
            <button className="secondary-button" disabled={busy} onClick={() => setName(null)}>取消</button>
            <button className="primary-button" disabled={busy || !name?.trim()} onClick={() => void rename()}>
              {busy && <LoaderCircle size={16} className="spin" />}保存名称
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label className="editor-name">
            订阅名称
            <input
              value={name || ""}
              autoFocus
              maxLength={120}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void rename(); }}
            />
          </label>
          <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ink-faint)" }}>
            只修改管理界面中的名称，原链接、公开配置和内容版本保持不变。
          </p>
          {error && <p role="alert" style={{ margin: 0, color: "var(--danger)" }}>{error}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting}
        title="删除订阅链接"
        message={`确定彻底删除订阅“${item.name}”吗？删除后该订阅的公开 Token 将永久失效，外部客户端将无法继续拉取更新。`}
        confirmText="确认删除"
        onClose={() => setDeleting(false)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
