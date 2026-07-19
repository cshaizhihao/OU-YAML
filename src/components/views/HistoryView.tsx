import { useEffect, useState } from "react";
import { Archive, Clock3, History, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { api } from "../../api";
import type { Project, ProjectVersion } from "../../shared/types";
import { ConfirmDialog } from "../Dialog";

export function HistoryView({ project, onRestore, onMessage }: { project: Project; onRestore: (project: Project) => void; onMessage: (message: string) => void }) {
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [restoring, setRestoring] = useState<ProjectVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.listVersions(project.id).then(setVersions).catch((error) => onMessage(error.message));
  useEffect(() => { load(); }, [project.id]);
  async function snapshot() { setBusy(true); try { const created = await api.createVersion(project.id); setVersions((current) => [created, ...current]); onMessage("快照已创建"); } catch (error) { onMessage(error instanceof Error ? error.message : "创建失败"); } finally { setBusy(false); } }
  return <>
    <div className="view-toolbar"><div className="summary-inline"><span><strong>{versions.length}</strong> 个历史版本</span></div><button className="primary-button" disabled={busy} onClick={snapshot}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}创建快照</button></div>
    {versions.length ? <div className="history-list">{versions.map((version) => <article className="history-row" key={version.id}><span className="history-line" /><span className="history-icon"><Archive size={18} /></span><div className="history-main"><h2>{version.label}</h2><span><Clock3 size={14} />{new Date(version.createdAt).toLocaleString("zh-CN")}</span></div><span className="type-badge">{version.targetFormat}</span><div className="history-counts"><span><strong>{version.proxyCount}</strong> 节点</span><span><strong>{version.groupCount}</strong> 组</span><span><strong>{version.ruleCount}</strong> 规则</span></div><button className="secondary-button compact-button" onClick={() => setRestoring(version)}><RotateCcw size={15} />恢复</button></article>)}</div> : <div className="empty-state"><div><History size={24} /></div><h2>还没有历史版本</h2><button className="primary-button" onClick={snapshot}><Save size={17} />创建快照</button></div>}
    <ConfirmDialog open={!!restoring} title="恢复历史版本" message={`确定恢复“${restoring?.label}”吗？当前配置会先自动备份。`} confirmText="恢复" onClose={() => setRestoring(null)} onConfirm={async () => { if (!restoring) return; setBusy(true); try { const restored = await api.restoreVersion(project.id, restoring.id); onRestore(restored); onMessage("历史版本已恢复"); await load(); } catch (error) { onMessage(error instanceof Error ? error.message : "恢复失败"); } finally { setRestoring(null); setBusy(false); } }} />
  </>;
}
