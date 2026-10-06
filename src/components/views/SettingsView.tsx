import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Download, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ShieldAlert, Upload } from "lucide-react";
import { api, type UpdateInfo, type UpdateStatus } from "../../api";
import type { MihomoConfig, Project } from "../../shared/types";
import { ConfirmDialog } from "../Dialog";

type SettingsProps = { project: Project; isAdmin: boolean; onChange: (updater: (current: Project) => Project) => void; onReload: () => Promise<void>; onMessage: (message: string) => void };

export function SettingsView({ project, isAdmin, onChange, onReload, onMessage }: SettingsProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [pendingBackup, setPendingBackup] = useState<{ name: string; content: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle", message: "等待操作", progress: 0, updatedAt: null });
  const [updateBusy, setUpdateBusy] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const updateConfig = <K extends keyof MihomoConfig>(key: K, value: MihomoConfig[K]) => onChange((current) => ({ ...current, config: { ...current.config, [key]: value } }));

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setPasswordBusy(true);
    try { await api.changePassword(currentPassword, newPassword); setCurrentPassword(""); setNewPassword(""); onMessage("密码已更新"); }
    catch (error) { onMessage(error instanceof Error ? error.message : "密码更新失败"); }
    finally { setPasswordBusy(false); }
  }

  async function downloadBackup() {
    setBackupBusy(true);
    try { const blob = await api.downloadBackup(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ou-yaml-${new Date().toISOString().slice(0, 10)}.oubackup.json`; anchor.click(); URL.revokeObjectURL(url); }
    catch (error) { onMessage(error instanceof Error ? error.message : "备份失败"); }
    finally { setBackupBusy(false); }
  }

  async function restore() {
    if (!pendingBackup) return; setBackupBusy(true);
    try { const result = await api.restoreBackup(pendingBackup.content, restoreMode); setPendingBackup(null); await onReload(); onMessage(`已恢复 ${result.projects} 个项目`); }
    catch (error) { onMessage(error instanceof Error ? error.message : "恢复失败"); }
    finally { setBackupBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function checkUpdate(silent = false) {
    setUpdateBusy(true);
    try { setUpdateInfo(await api.checkUpdate()); if (!silent) onMessage("已完成版本检查"); }
    catch (error) { if (!silent) onMessage(error instanceof Error ? error.message : "检查更新失败"); }
    finally { setUpdateBusy(false); }
  }

  async function refreshUpdateStatus() {
    try { setUpdateStatus(await api.getUpdateStatus()); } catch { /* 登录状态变化时由主页面处理 */ }
  }

  async function startUpdate() {
    setConfirmUpdate(false); setUpdateBusy(true);
    try { await api.startUpdate(); await refreshUpdateStatus(); onMessage("更新任务已提交，服务会自动重启"); }
    catch (error) { onMessage(error instanceof Error ? error.message : "启动更新失败"); }
    finally { setUpdateBusy(false); }
  }

  useEffect(() => { if (isAdmin) { void checkUpdate(true); void refreshUpdateStatus(); } }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin || !["requested", "running"].includes(updateStatus.status)) return;
    const timer = window.setInterval(() => { void refreshUpdateStatus(); }, 1500);
    return () => window.clearInterval(timer);
  }, [isAdmin, updateStatus.status]);

  return <div className="settings-layout">
    <section className="settings-section"><header><h2>项目</h2></header><div className="settings-form"><label>配置名称<input value={project.name} onChange={(e) => onChange((current) => ({ ...current, name: e.target.value }))} /></label></div></section>
    <details className="settings-advanced"><summary>高级运行参数与网络设置 <span>端口、模式、日志和 IPv6</span></summary>    <section className="settings-section"><header><h2>运行参数</h2></header><div className="settings-form two-columns"><label>混合端口<input type="number" min={1} max={65535} value={project.config.mixedPort} onChange={(e) => updateConfig("mixedPort", Number(e.target.value))} /></label><label>运行模式<select value={project.config.mode} onChange={(e) => updateConfig("mode", e.target.value as MihomoConfig["mode"])}><option value="rule">规则</option><option value="global">全局</option><option value="direct">直连</option></select></label><label>日志级别<select value={project.config.logLevel} onChange={(e) => updateConfig("logLevel", e.target.value as MihomoConfig["logLevel"])}><option value="silent">静默</option><option value="error">错误</option><option value="warning">警告</option><option value="info">信息</option><option value="debug">调试</option></select></label><label>外部控制器<input value={project.config.externalController} onChange={(e) => updateConfig("externalController", e.target.value)} /></label></div></section>
    <section className="settings-section"><header><h2>网络</h2></header><div className="toggle-stack"><label className="toggle-row"><span><strong>允许局域网连接</strong><small>allow-lan</small></span><input type="checkbox" checked={project.config.allowLan} onChange={(e) => updateConfig("allowLan", e.target.checked)} /></label><label className="toggle-row"><span><strong>启用 IPv6</strong><small>ipv6</small></span><input type="checkbox" checked={project.config.ipv6} onChange={(e) => updateConfig("ipv6", e.target.checked)} /></label></div></section>
    </details>
    <section className="settings-section"><header><h2>账号密码</h2></header><form className="settings-form two-columns" onSubmit={changePassword}><label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密码<input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><div className="settings-actions span-2"><button className="secondary-button" disabled={passwordBusy || !currentPassword || newPassword.length < 10}>{passwordBusy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}更新密码</button></div></form></section>
    <section className="settings-section"><header><h2>数据备份</h2></header><div className="settings-form"><label>恢复方式<select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value as "merge" | "replace")}><option value="merge">合并项目</option><option value="replace">替换全部</option></select></label><input ref={fileInput} hidden type="file" accept=".json,.oubackup" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setPendingBackup({ name: file.name, content: await file.text() }); }} /><div className="settings-actions"><button className="secondary-button" disabled={backupBusy} onClick={downloadBackup}>{backupBusy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}下载备份</button><button className="secondary-button" disabled={backupBusy} onClick={() => fileInput.current?.click()}><Upload size={17} />恢复备份</button></div></div></section>
    {isAdmin && <section className="settings-section update-section"><header><h2>网页更新</h2><p>参考妙妙屋的版本检查体验，由主机代理安全执行更新。</p></header><div className="update-card"><div className="update-card-top"><div><span className="eyebrow">OU-YAML RELEASE</span><strong>{updateInfo?.hasUpdate ? `发现新版本 v${updateInfo.latestVersion}` : `当前版本 v${updateInfo?.currentVersion || "检查中"}`}</strong></div><button className="secondary-button compact-button" onClick={() => void checkUpdate()} disabled={updateBusy}><RefreshCw size={15} className={updateBusy ? "spin" : ""} />检查更新</button></div>{updateInfo?.hasUpdate ? <><div className="update-release"><div><strong>v{updateInfo.latestVersion} 可用</strong><small>{updateInfo.publishedAt ? new Date(updateInfo.publishedAt).toLocaleDateString("zh-CN") : "最新发布"}</small></div>{updateInfo.releaseUrl && <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer" className="text-button">查看发布页 <ExternalLink size={14} /></a>}</div>{updateInfo.releaseNotes && <pre className="update-notes">{updateInfo.releaseNotes}</pre>}<button className="primary-button" disabled={updateBusy || updateStatus.status === "running" || !updateInfo.agentAvailable} onClick={() => setConfirmUpdate(true)}><RefreshCw size={17} />立即更新</button>{!updateInfo.agentAvailable && <p className="update-hint"><ShieldAlert size={15} />当前部署未安装网页更新代理，请运行最新安装脚本。</p>}</> : <div className="update-ready"><CheckCircle2 size={18} />{updateInfo ? "已经是最新版本" : "正在连接 GitHub 检查版本"}</div>}{["requested", "running", "completed", "failed"].includes(updateStatus.status) && <div className={`update-progress ${updateStatus.status}`}><div className="update-progress-label"><span>{updateStatus.message}</span><b>{updateStatus.progress}%</b></div><div className="update-progress-track"><i style={{ width: `${updateStatus.progress}%` }} /></div>{updateStatus.status === "completed" && <small>页面将在服务重启后自动恢复。</small>}{updateStatus.status === "failed" && <small>更新失败，请查看主机上的 data/web-update.log。</small>}</div>}</div></section>}
    <ConfirmDialog open={!!pendingBackup} title="恢复数据备份" message={`${restoreMode === "replace" ? "现有项目将被全部替换。" : "备份项目将合并到当前账号。"} 文件：${pendingBackup?.name || ""}`} confirmText="开始恢复" onClose={() => { setPendingBackup(null); if (fileInput.current) fileInput.current.value = ""; }} onConfirm={restore} />
    <ConfirmDialog open={confirmUpdate} title="确认更新 OU-YAML" message="系统会先备份数据，再拉取 GitHub 最新版本、重建容器并重启服务。更新期间页面会短暂不可用。" confirmText="开始更新" onClose={() => setConfirmUpdate(false)} onConfirm={startUpdate} />
  </div>;
}
