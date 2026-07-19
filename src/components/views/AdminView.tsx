import { useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, UserRound, UserX } from "lucide-react";
import { api } from "../../api";
import type { SessionUser, UserAccount } from "../../shared/types";
import { ConfirmDialog, Drawer } from "../Dialog";

type DraftUser = { id?: string; username: string; password: string; isAdmin: boolean; disabled: boolean };
const blankUser = (): DraftUser => ({ username: "", password: "", isAdmin: false, disabled: false });

export function AdminView({ currentUser, onMessage }: { currentUser: SessionUser; onMessage: (message: string) => void }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [editing, setEditing] = useState<DraftUser | null>(null);
  const [deleting, setDeleting] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.listUsers().then(setUsers).catch((error) => onMessage(error.message));
  useEffect(() => { load(); }, []);
  async function save(draft: DraftUser) {
    setBusy(true);
    try {
      if (draft.id) {
        const saved = await api.updateUser(draft.id, { isAdmin: draft.isAdmin, disabled: draft.disabled, ...(draft.password ? { password: draft.password } : {}) });
        setUsers((current) => current.map((item) => item.id === saved.id ? saved : item));
      } else {
        const created = await api.createUser(draft.username, draft.password, draft.isAdmin); setUsers((current) => [...current, created]);
      }
      setEditing(null); onMessage("用户已保存");
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存用户失败"); }
    finally { setBusy(false); }
  }
  return <>
    <div className="view-toolbar"><div className="summary-inline"><span><strong>{users.length}</strong> 个用户</span><i /><span><strong>{users.filter((user) => !user.disabled).length}</strong> 个可用</span></div><button className="primary-button" onClick={() => setEditing(blankUser())}><Plus size={17} />添加用户</button></div>
    <div className="user-list">{users.map((user) => <article className="user-row" key={user.id}><span className={user.disabled ? "user-list-icon disabled" : "user-list-icon"}>{user.disabled ? <UserX size={20} /> : user.isAdmin ? <ShieldCheck size={20} /> : <UserRound size={20} />}</span><div className="user-list-main"><h2>{user.username}</h2><span>{user.isAdmin ? "管理员" : "普通用户"}</span></div><span className={user.disabled ? "status-badge disabled" : "status-badge active"}>{user.disabled ? "已禁用" : "可用"}</span><div className="user-project-count"><strong>{user.projectCount}</strong><span>项目</span></div><span className="user-created">{new Date(user.createdAt).toLocaleDateString("zh-CN")}</span><div className="row-actions"><button className="icon-button compact" onClick={() => setEditing({ id: user.id, username: user.username, password: "", isAdmin: user.isAdmin, disabled: user.disabled })} aria-label={`编辑 ${user.username}`}><Pencil size={16} /></button><button className="icon-button compact danger" disabled={user.username === currentUser.username} onClick={() => setDeleting(user)} aria-label={`删除 ${user.username}`}><Trash2 size={16} /></button></div></article>)}</div>
    <UserEditor key={editing?.id || (editing ? "new" : "closed")} draft={editing} busy={busy} currentUsername={currentUser.username} onClose={() => setEditing(null)} onSave={save} />
    <ConfirmDialog open={!!deleting} title="删除用户" message={`确定删除“${deleting?.username}”及其全部项目吗？该操作不能撤销。`} onClose={() => setDeleting(null)} onConfirm={async () => { if (!deleting) return; try { await api.deleteUser(deleting.id); setUsers((current) => current.filter((item) => item.id !== deleting.id)); setDeleting(null); onMessage("用户已删除"); } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); } }} />
  </>;
}

function UserEditor({ draft, busy, currentUsername, onClose, onSave }: { draft: DraftUser | null; busy: boolean; currentUsername: string; onClose: () => void; onSave: (draft: DraftUser) => void }) {
  const [value, setValue] = useState(draft);
  if (!value) return null;
  const isCurrent = value.username === currentUsername;
  const passwordValid = value.id ? !value.password || value.password.length >= 10 : value.password.length >= 10;
  return <Drawer title={value.id ? `编辑 ${value.username}` : "添加用户"} open onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy || !passwordValid || value.username.length < 3} onClick={() => onSave(value)}>{busy && <LoaderCircle className="spin" size={17} />}保存用户</button></>}><div className="form-grid"><label className="span-2">账号<input value={value.username} disabled={!!value.id} onChange={(event) => setValue({ ...value, username: event.target.value })} /></label><label className="span-2">{value.id ? "重置密码" : "初始密码"}<input type="password" autoComplete="new-password" value={value.password} onChange={(event) => setValue({ ...value, password: event.target.value })} /></label><label className="toggle-row span-2"><span><strong>管理员</strong><small>用户与系统管理权限</small></span><input type="checkbox" checked={value.isAdmin} disabled={isCurrent} onChange={(event) => setValue({ ...value, isAdmin: event.target.checked })} /></label><label className="toggle-row span-2"><span><strong>禁用账号</strong><small>立即撤销该用户会话</small></span><input type="checkbox" checked={value.disabled} disabled={isCurrent} onChange={(event) => setValue({ ...value, disabled: event.target.checked })} /></label></div></Drawer>;
}
