import { useRef, useState, type FormEvent } from "react";
import { Download, KeyRound, LoaderCircle, Upload } from "lucide-react";
import { api } from "../../api";
import type { MihomoConfig, Project } from "../../shared/types";
import { ConfirmDialog } from "../Dialog";

export function SettingsView({ project, onChange, onReload, onMessage }: { project: Project; onChange: (updater: (current: Project) => Project) => void; onReload: () => Promise<void>; onMessage: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [pendingBackup, setPendingBackup] = useState<{ name: string; content: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
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
    try {
      const blob = await api.downloadBackup(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ou-yaml-${new Date().toISOString().slice(0, 10)}.oubackup.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { onMessage(error instanceof Error ? error.message : "备份失败"); }
    finally { setBackupBusy(false); }
  }

  async function restore() {
    if (!pendingBackup) return; setBackupBusy(true);
    try { const result = await api.restoreBackup(pendingBackup.content, restoreMode); setPendingBackup(null); await onReload(); onMessage(`已恢复 ${result.projects} 个项目`); }
    catch (error) { onMessage(error instanceof Error ? error.message : "恢复失败"); }
    finally { setBackupBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  return <div className="settings-layout">
    <section className="settings-section"><header><h2>项目</h2></header><div className="settings-form"><label>配置名称<input value={project.name} onChange={(e) => onChange((current) => ({ ...current, name: e.target.value }))} /></label></div></section>
    <section className="settings-section"><header><h2>运行参数</h2></header><div className="settings-form two-columns"><label>混合端口<input type="number" min={1} max={65535} value={project.config.mixedPort} onChange={(e) => updateConfig("mixedPort", Number(e.target.value))} /></label><label>运行模式<select value={project.config.mode} onChange={(e) => updateConfig("mode", e.target.value as MihomoConfig["mode"])}><option value="rule">规则</option><option value="global">全局</option><option value="direct">直连</option></select></label><label>日志级别<select value={project.config.logLevel} onChange={(e) => updateConfig("logLevel", e.target.value as MihomoConfig["logLevel"])}><option value="silent">静默</option><option value="error">错误</option><option value="warning">警告</option><option value="info">信息</option><option value="debug">调试</option></select></label><label>外部控制器<input value={project.config.externalController} onChange={(e) => updateConfig("externalController", e.target.value)} /></label></div></section>
    <section className="settings-section"><header><h2>网络</h2></header><div className="toggle-stack"><label className="toggle-row"><span><strong>允许局域网连接</strong><small>allow-lan</small></span><input type="checkbox" checked={project.config.allowLan} onChange={(e) => updateConfig("allowLan", e.target.checked)} /></label><label className="toggle-row"><span><strong>启用 IPv6</strong><small>ipv6</small></span><input type="checkbox" checked={project.config.ipv6} onChange={(e) => updateConfig("ipv6", e.target.checked)} /></label></div></section>
    <section className="settings-section"><header><h2>账号密码</h2></header><form className="settings-form two-columns" onSubmit={changePassword}><label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密码<input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><div className="settings-actions span-2"><button className="secondary-button" disabled={passwordBusy || !currentPassword || newPassword.length < 10}>{passwordBusy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}更新密码</button></div></form></section>
    <section className="settings-section"><header><h2>数据备份</h2></header><div className="settings-form"><label>恢复方式<select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value as "merge" | "replace")}><option value="merge">合并项目</option><option value="replace">替换全部</option></select></label><input ref={fileInput} hidden type="file" accept=".json,.oubackup" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setPendingBackup({ name: file.name, content: await file.text() }); }} /><div className="settings-actions"><button className="secondary-button" disabled={backupBusy} onClick={downloadBackup}>{backupBusy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}下载备份</button><button className="secondary-button" disabled={backupBusy} onClick={() => fileInput.current?.click()}><Upload size={17} />恢复备份</button></div></div></section>
    <ConfirmDialog open={!!pendingBackup} title="恢复数据备份" message={`${restoreMode === "replace" ? "现有项目将被全部替换。" : "备份项目将合并到当前账号。"} 文件：${pendingBackup?.name || ""}`} confirmText="开始恢复" onClose={() => { setPendingBackup(null); if (fileInput.current) fileInput.current.value = ""; }} onConfirm={restore} />
  </div>;
}
