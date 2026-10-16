import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderGit2,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Network,
  RefreshCw,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Upload,
} from "lucide-react";
import { api, type TurnstileSettings, type UpdateInfo, type UpdateStatus } from "../../api";
import type { MihomoConfig, Project } from "../../shared/types";
import { ConfirmDialog } from "../Dialog";

type SettingsProps = {
  project: Project;
  isAdmin: boolean;
  onChange: (updater: (current: Project) => Project) => void;
  onReload: () => Promise<void>;
  onMessage: (message: string) => void;
};

export function SettingsView({ project, isAdmin, onChange, onReload, onMessage }: SettingsProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [pendingBackup, setPendingBackup] = useState<{ name: string; content: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle", message: "等待操作", progress: 0, updatedAt: null });
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateChannel, setUpdateChannel] = useState<"stable" | "preview">("stable");
  const [updateError, setUpdateError] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updateLog, setUpdateLog] = useState("");
  const [showUpdateLog, setShowUpdateLog] = useState(false);
  const [turnstileConfig, setTurnstileConfig] = useState<TurnstileSettings>({
    enabled: false,
    siteKey: "",
    secretKey: "",
    hasSecretKey: false,
  });
  const [turnstileBusy, setTurnstileBusy] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showTurnstileHelp, setShowTurnstileHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previousUpdateStatus = useRef<UpdateStatus["status"]>("idle");

  const updateConfig = <K extends keyof MihomoConfig>(key: K, value: MihomoConfig[K]) =>
    onChange((current) => ({ ...current, config: { ...current.config, [key]: value } }));

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      onMessage("密码已成功更新");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "密码更新失败");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function downloadBackup() {
    setBackupBusy(true);
    try {
      const blob = await api.downloadBackup();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ou-yaml-${new Date().toISOString().slice(0, 10)}.oubackup.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "备份失败");
    } finally {
      setBackupBusy(false);
    }
  }

  async function restore() {
    if (!pendingBackup) return;
    setBackupBusy(true);
    try {
      const result = await api.restoreBackup(pendingBackup.content, restoreMode);
      setPendingBackup(null);
      await onReload();
      onMessage(`完整资源恢复完成，共恢复 ${result.projects} 个项目`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBackupBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function checkUpdate(silent = false) {
    setUpdateBusy(true);
    setUpdateError("");
    try {
      setUpdateInfo(await api.checkUpdate(updateChannel));
      if (!silent) onMessage("已完成版本检查");
    } catch (error) {
      setUpdateInfo(null);
      setUpdateError((error as Error).message);
      if (!silent) onMessage((error as Error).message);
    } finally {
      setUpdateBusy(false);
    }
  }

  async function refreshUpdateStatus() {
    try {
      const next = await api.getUpdateStatus();
      setUpdateStatus(next);
      if (next.status === "completed" && ["requested", "running"].includes(previousUpdateStatus.current)) {
        void checkUpdate(true);
      }
      previousUpdateStatus.current = next.status;
      if (["running", "completed", "failed"].includes(next.status)) {
        setUpdateLog((await api.getUpdateLog()).log);
      }
    } catch {
      /* 忽略轮询瞬时异常 */
    }
  }

  async function openUpdateLog() {
    try {
      setUpdateLog((await api.getUpdateLog()).log);
      setShowUpdateLog(true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "更新日志读取失败");
    }
  }

  async function startUpdate() {
    setConfirmUpdate(false);
    setUpdateBusy(true);
    try {
      setUpdateLog("");
      setShowUpdateLog(true);
      await api.startUpdate(updateChannel);
      await refreshUpdateStatus();
      onMessage("更新任务已提交，服务会自动备份并在失败时回滚");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "启动更新失败");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function saveTurnstile(event: FormEvent) {
    event.preventDefault();
    if (turnstileConfig.enabled && !turnstileConfig.siteKey.trim()) {
      onMessage("启用验证盾前，必须填写 Cloudflare Site Key");
      return;
    }
    if (turnstileConfig.enabled && !turnstileConfig.secretKey.trim() && !turnstileConfig.hasSecretKey) {
      onMessage("启用验证盾前，必须填写 Cloudflare Secret Key");
      return;
    }
    setTurnstileBusy(true);
    try {
      await api.saveTurnstileSettings({
        enabled: turnstileConfig.enabled,
        siteKey: turnstileConfig.siteKey.trim(),
        secretKey: turnstileConfig.secretKey.trim(),
      });
      onMessage("Cloudflare Turnstile 人机验证盾设置已成功更新");
      const fresh = await api.getTurnstileSettings();
      setTurnstileConfig(fresh);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "保存 Turnstile 设置失败");
    } finally {
      setTurnstileBusy(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      void checkUpdate(true);
      void refreshUpdateStatus();
      void (async () => {
        try {
          const cfg = await api.getTurnstileSettings();
          setTurnstileConfig(cfg);
        } catch {
          /* 忽略非关键错误 */
        }
      })();
    }
  }, [isAdmin, updateChannel]);

  useEffect(() => {
    if (!isAdmin || !["requested", "running"].includes(updateStatus.status)) return;
    const timer = window.setInterval(() => { void refreshUpdateStatus(); }, 1500);
    return () => window.clearInterval(timer);
  }, [isAdmin, updateStatus.status]);

  const currentBuild = updateInfo?.currentCommit?.slice(0, 7);
  const latestBuild = updateInfo?.latestCommit?.slice(0, 7);
  const updateHeadline = updateInfo?.updateKind === "build" ? "发现新版构建" : `发现新版本 v${updateInfo?.latestVersion}`;
  const availableHeadline = updateInfo?.updateKind === "build" ? `构建 ${latestBuild || "main"} 可用` : `v${updateInfo?.latestVersion} 可用`;

  return (
    <div className="settings-layout">
      {/* 1. 当前项目配置卡片 */}
      <section className="settings-card">
        <header className="settings-card-header">
          <div className="settings-card-title-group">
            <span className="settings-card-icon"><FolderGit2 size={18} /></span>
            <div>
              <h2>项目基础设置</h2>
              <p>当前正在编辑的项目工程名称与格式基准</p>
            </div>
          </div>
          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", border: "1px solid var(--line)", color: "var(--ink-faint)" }}>
            格式：{project.targetFormat === "sing-box" ? "sing-box JSON" : "Mihomo YAML"}
          </span>
        </header>

        <div className="settings-form">
          <label>
            配置工程名称
            <input
              value={project.name}
              maxLength={80}
              placeholder="我的日常配置"
              onChange={(e) => onChange((current) => ({ ...current, name: e.target.value }))}
            />
          </label>
        </div>
      </section>

      {/* 2. 高级运行参数与网络（手风琴卡片） */}
      <section className="settings-card accordion-card">
        <header
          className="settings-card-header accordion-header"
          onClick={() => setShowAdvanced(!showAdvanced)}
          title={showAdvanced ? "收起高级参数" : "展开高级运行参数"}
        >
          <div className="settings-card-title-group">
            <span className="settings-card-icon"><SlidersHorizontal size={18} /></span>
            <div>
              <h2>高级运行参数与网络</h2>
              <p>内核混合端口、运行模式、日志级别、局域网连接与 IPv6</p>
            </div>
          </div>
          <button type="button" className="secondary-button compact-button" style={{ height: "30px", fontSize: "12px" }}>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showAdvanced ? "收起参数" : "展开参数"}</span>
          </button>
        </header>

        {showAdvanced && (
          <div className="accordion-body">
            <div className="settings-form four-columns">
              <label>
                混合端口 (mixed-port)
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={project.config.mixedPort}
                  onChange={(e) => updateConfig("mixedPort", Number(e.target.value))}
                />
              </label>

              <label>
                运行模式 (mode)
                <select value={project.config.mode} onChange={(e) => updateConfig("mode", e.target.value as MihomoConfig["mode"])}>
                  <option value="rule">规则 (rule)</option>
                  <option value="global">全局 (global)</option>
                  <option value="direct">直连 (direct)</option>
                </select>
              </label>

              <label>
                日志级别 (log-level)
                <select value={project.config.logLevel} onChange={(e) => updateConfig("logLevel", e.target.value as MihomoConfig["logLevel"])}>
                  <option value="silent">静默 (silent)</option>
                  <option value="error">错误 (error)</option>
                  <option value="warning">警告 (warning)</option>
                  <option value="info">信息 (info)</option>
                  <option value="debug">调试 (debug)</option>
                </select>
              </label>

              <label>
                外部控制器 (external-controller)
                <input
                  value={project.config.externalController}
                  placeholder="127.0.0.1:9090"
                  onChange={(e) => updateConfig("externalController", e.target.value)}
                />
              </label>
            </div>

            <div className="toggle-stack">
              <label className="toggle-row">
                <span>
                  <strong>允许局域网设备连接</strong>
                  <small style={{ display: "block", color: "var(--ink-faint)", fontSize: "12px" }}>allow-lan · 开启后同一局域网设备可通过此端口代理流量</small>
                </span>
                <input type="checkbox" checked={project.config.allowLan} onChange={(e) => updateConfig("allowLan", e.target.checked)} />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>启用 IPv6 支持</strong>
                  <small style={{ display: "block", color: "var(--ink-faint)", fontSize: "12px" }}>ipv6 · 解析并路由 AAAA 记录流量</small>
                </span>
                <input type="checkbox" checked={project.config.ipv6} onChange={(e) => updateConfig("ipv6", e.target.checked)} />
              </label>
            </div>
          </div>
        )}
      </section>

      {/* 3. 账户密码安全 */}
      <section className="settings-card">
        <header className="settings-card-header">
          <div className="settings-card-title-group">
            <span className="settings-card-icon"><KeyRound size={18} /></span>
            <div>
              <h2>账号与安全</h2>
              <p>修改当前登录账户的访问密码（最少 10 位）</p>
            </div>
          </div>
          <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", background: isAdmin ? "rgba(56,189,248,0.15)" : "rgba(16,185,129,0.15)", border: `1px solid ${isAdmin ? "rgba(56,189,248,0.35)" : "rgba(16,185,129,0.3)"}`, color: isAdmin ? "#38bdf8" : "#6ee7b7" }}>
            {isAdmin ? "超级管理员" : "标准用户"}
          </span>
        </header>

        <form className="settings-form two-columns" onSubmit={changePassword}>
          <label>
            当前密码
            <input
              type="password"
              autoComplete="current-password"
              placeholder="输入原密码"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              placeholder="至少 10 位新密码"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <div className="settings-actions span-2" style={{ gridColumn: "1 / -1" }}>
            <button
              className="primary-button"
              type="submit"
              disabled={passwordBusy || !currentPassword || newPassword.length < 10}
            >
              {passwordBusy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              更新密码
            </button>
          </div>
        </form>
      </section>

      {/* 4. 完整数据备份与恢复 */}
      <section className="settings-card">
        <header className="settings-card-header">
          <div className="settings-card-title-group">
            <span className="settings-card-icon"><HardDrive size={18} /></span>
            <div>
              <h2>完整数据备份与恢复</h2>
              <p>导出当前账号的项目、历史版本、节点来源、节点库、分流规则与生成订阅记录</p>
            </div>
          </div>
        </header>

        <div className="settings-form">
          <label>
            恢复合并策略
            <select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value as "merge" | "replace")}>
              <option value="merge">安全合并全部资源（推荐 · 不覆盖已有资产）</option>
              <option value="replace">全量替换当前账号全部资源（谨慎操作）</option>
            </select>
          </label>

          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".json,.oubackup"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setPendingBackup({ name: file.name, content: await file.text() });
            }}
          />

          <div className="settings-actions">
            <button className="secondary-button" disabled={backupBusy} onClick={downloadBackup}>
              {backupBusy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
              下载完整备份
            </button>
            <button className="secondary-button" disabled={backupBusy} onClick={() => fileInput.current?.click()}>
              <Upload size={16} />
              恢复备份文件
            </button>
          </div>
        </div>
      </section>

      {/* 5. Cloudflare Turnstile 人机验证盾 (仅管理员专享) */}
      {isAdmin && (
        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-card-title-group">
              <span className="settings-card-icon" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", borderColor: "rgba(245, 158, 11, 0.3)" }}>
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2>Cloudflare Turnstile 人机验证盾</h2>
                <p>自主接入 Cloudflare 官方人机防御，全自动抵御撞库与恶意注册攻击</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                background: turnstileConfig.enabled && turnstileConfig.siteKey ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.06)",
                border: `1px solid ${turnstileConfig.enabled && turnstileConfig.siteKey ? "rgba(16, 185, 129, 0.3)" : "var(--line)"}`,
                color: turnstileConfig.enabled && turnstileConfig.siteKey ? "#6ee7b7" : "var(--ink-faint)"
              }}>
                {turnstileConfig.enabled && turnstileConfig.siteKey ? "防护运行中" : "未开启防护"}
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.35)", color: "#38bdf8" }}>
                管理员专属
              </span>
            </div>
          </header>

          <form className="settings-form" onSubmit={saveTurnstile}>
            <div className="toggle-stack">
              <label className="toggle-row" style={{ cursor: "pointer" }}>
                <span>
                  <strong>开启登录与注册人机验证防护</strong>
                  <small style={{ display: "block", color: "var(--ink-faint)", fontSize: "12px", marginTop: "2px" }}>
                    开启后，用户在登录和注册时必须通过 Cloudflare 智能无感/交互验证；未配置或不可用时自动优雅降级放行
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={turnstileConfig.enabled}
                  onChange={(e) => setTurnstileConfig((c) => ({ ...c, enabled: e.target.checked }))}
                />
              </label>
            </div>

            <div className="settings-form two-columns">
              <label>
                Site Key (站点密钥 / 前端公共密钥)
                <input
                  type="text"
                  placeholder="例如：0x4AAAAAAAxSiteKey..."
                  value={turnstileConfig.siteKey}
                  onChange={(e) => setTurnstileConfig((c) => ({ ...c, siteKey: e.target.value }))}
                />
                <small style={{ color: "var(--ink-faint)", fontSize: "11.5px", marginTop: "4px", display: "block" }}>
                  在 Cloudflare 控制台 Turnstile 站点获取，用于前端渲染人机验证小组件
                </small>
              </label>

              <label>
                Secret Key (通信密钥 / 后端校验私钥)
                <div className="password-field" style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type={showSecretKey ? "text" : "password"}
                    placeholder={turnstileConfig.hasSecretKey ? "密钥已安全保存 (留空保持原样)" : "例如：0x4AAAAAAAxSecretKey..."}
                    value={turnstileConfig.secretKey}
                    onChange={(e) => setTurnstileConfig((c) => ({ ...c, secretKey: e.target.value }))}
                    style={{ width: "100%", paddingRight: "36px" }}
                  />
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    aria-label={showSecretKey ? "隐藏密钥" : "显示密钥"}
                    style={{ position: "absolute", right: "6px", top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none" }}
                  >
                    {showSecretKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <small style={{ color: "var(--ink-faint)", fontSize: "11.5px", marginTop: "4px", display: "block" }}>
                  {turnstileConfig.hasSecretKey ? "✓ 后端已安全保存密钥；如需更换直接输入新密钥即可" : "用于后端向 Cloudflare 校验 Token 有效性，绝不对外公开"}
                </small>
              </label>
            </div>

            <div style={{ background: "rgba(255, 255, 255, 0.02)", border: "1px dashed rgba(255, 255, 255, 0.12)", borderRadius: "var(--radius-md)", padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: "6px" }}>
                  💡 如何在 Cloudflare 免费获取 Turnstile 密钥？
                </span>
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: "12px" }}
                  onClick={() => setShowTurnstileHelp(!showTurnstileHelp)}
                >
                  {showTurnstileHelp ? "收起指引" : "查看获取步骤"}
                </button>
              </div>

              {showTurnstileHelp && (
                <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--ink-faint)", lineHeight: 1.6, borderTop: "1px solid var(--line)", paddingTop: "10px" }}>
                  <ol style={{ paddingLeft: "18px", margin: 0, display: "grid", gap: "6px" }}>
                    <li>
                      访问并在 Cloudflare 仪表盘登录：
                      <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noreferrer" style={{ color: "var(--accent-hover)", textDecoration: "underline", marginLeft: "4px" }}>
                        Cloudflare Turnstile 控制台 <ExternalLink size={11} style={{ display: "inline" }} />
                      </a>
                    </li>
                    <li>点击 <strong>添加站点 (Add site)</strong>，站点名称可输入 <code>OU-YAML</code>。</li>
                    <li>在“网域 (Domain)”中填入您的服务器 IP（如 <code>216.195.195.160</code>）或绑定的域名。本地调试亦可添加 <code>localhost</code>。</li>
                    <li>小组件模式推荐选择 <strong>托管 (Managed)</strong>（智能评估威胁，大多数正常访问无感通过）。</li>
                    <li>创建完成后，将生成的 <strong>Site Key</strong> 和 <strong>Secret Key</strong> 复制填入上方输入框，勾选开启并点击“保存验证盾配置”。</li>
                  </ol>
                </div>
              )}
            </div>

            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={turnstileBusy}>
                {turnstileBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
                保存验证盾配置
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 6. 网页在线更新（仅管理员专享） */}
      {isAdmin && (
        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-card-title-group">
              <span className="settings-card-icon"><Rocket size={18} /></span>
              <div>
                <h2>系统版本与在线更新</h2>
                <p>一键自动备份、拉取 GitHub 官方稳定或测试构建并在失败时自动回滚</p>
              </div>
            </div>
            <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px", background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.35)", color: "#38bdf8" }}>
              管理员专属
            </span>
          </header>

          <div className="update-card-content">
            <label className="update-channel">
              更新发布渠道
              <select
                value={updateChannel}
                disabled={updateBusy || ["requested", "running"].includes(updateStatus.status)}
                onChange={(event) => setUpdateChannel(event.target.value as "stable" | "preview")}
              >
                <option value="stable">稳定版 (Stable · 推荐正式使用)</option>
                <option value="preview">测试版 (Preview · main 最新构建)</option>
              </select>
            </label>

            {updateError && <p role="alert" style={{ color: "var(--danger)", fontSize: "13px" }}>{updateError}</p>}

            <div className="update-card-top">
              <div>
                <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: "1px", color: "var(--accent-hover)" }}>OU-YAML RELEASE</span>
                <strong>{updateInfo?.hasUpdate ? updateHeadline : `当前版本 v${updateInfo?.currentVersion || "检查中"}${currentBuild ? ` · ${currentBuild}` : ""}`}</strong>
              </div>
              <div className="row-actions" style={{ display: "flex", gap: "8px" }}>
                <button className="secondary-button compact-button" onClick={() => void openUpdateLog()}>
                  <TerminalSquare size={14} />日志
                </button>
                <button className="secondary-button compact-button" onClick={() => void checkUpdate()} disabled={updateBusy}>
                  <RefreshCw size={14} className={updateBusy ? "spin" : ""} />检查更新
                </button>
              </div>
            </div>

            <div className="update-safety">
              <ShieldCheck size={16} />
              <span>更新前环境已就绪 · 支持故障自动回滚与数据快照保护</span>
            </div>

            {updateInfo?.hasUpdate ? (
              <>
                <div className="update-release">
                  <div>
                    <strong>{availableHeadline}</strong>
                    <small>{updateInfo.publishedAt ? new Date(updateInfo.publishedAt).toLocaleDateString("zh-CN") : "最新发布"}</small>
                  </div>
                  {updateInfo.releaseUrl && (
                    <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer" className="text-button">
                      查看 GitHub 更新日志 <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                {updateInfo.releaseNotes && <pre className="update-notes">{updateInfo.releaseNotes}</pre>}
                <button
                  className="primary-button"
                  disabled={updateBusy || ["requested", "running"].includes(updateStatus.status) || !updateInfo.agentAvailable}
                  onClick={() => setConfirmUpdate(true)}
                >
                  <RefreshCw size={16} />立即更新系统
                </button>
                {!updateInfo.agentAvailable && (
                  <p className="update-hint">
                    <ShieldAlert size={14} />当前部署未检测到更新守护代理，请在服务器重新运行最新一键部署脚本以启用在线更新。
                  </p>
                )}
              </>
            ) : (
              <div className="update-ready">
                <CheckCircle2 size={17} />
                {updateInfo ? "当前渠道已是最新版本，运行状态良好" : updateError ? "版本检查未完成，请重试" : "正在连接 GitHub 校验版本…"}
              </div>
            )}

            {["requested", "running", "completed", "failed"].includes(updateStatus.status) && (
              <div className={`update-progress ${updateStatus.status}`}>
                <div className="update-progress-label">
                  <span>{updateStatus.message}</span>
                  <b>{updateStatus.progress}%</b>
                </div>
                <div className="update-progress-track">
                  <i style={{ width: `${updateStatus.progress}%` }} />
                </div>
                {updateStatus.status === "completed" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "4px" }}>
                    <small>更新顺利完成！刷新页面即可加载全新版本。</small>
                    <button className="primary-button compact-button" onClick={() => window.location.reload()}>刷新页面</button>
                  </div>
                )}
                {updateStatus.status === "failed" && (
                  <small style={{ color: "var(--danger)" }}>更新未完成；若新版未通过健康检查，代理会自动恢复更新前版本。</small>
                )}
              </div>
            )}

            {showUpdateLog && (
              <div style={{ marginTop: "10px", display: "grid", gap: "6px" }}>
                <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "12px", color: "var(--ink-soft)" }}>主机更新实时日志</strong>
                  <button className="text-button" style={{ fontSize: "11px" }} onClick={() => void openUpdateLog()}>
                    <RefreshCw size={12} />刷新日志
                  </button>
                </header>
                <pre className="update-log">{updateLog || "暂无日志"}</pre>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 确认还原备份对话框 */}
      <ConfirmDialog
        open={!!pendingBackup}
        title="恢复完整数据备份"
        message={`${restoreMode === "replace" ? "警告：当前账号的所有项目、节点、来源与发布记录都将被完全替换！" : "备份中的全部资源将安全合并到当前账号。"} 为确保安全，恢复后的订阅公开发布记录默认撤销。备份文件：${pendingBackup?.name || ""}`}
        confirmText="确认恢复"
        onClose={() => {
          setPendingBackup(null);
          if (fileInput.current) fileInput.current.value = "";
        }}
        onConfirm={restore}
      />

      {/* 确认系统更新对话框 */}
      <ConfirmDialog
        open={confirmUpdate}
        title="确认更新 OU-YAML 系统"
        message="系统会先自动执行完整数据备份，再拉取 GitHub 官方最新版本并执行全套健康检查；若检测到异常会自动无痛回滚。更新期间服务将短暂重启约 5-15 秒。"
        confirmText="开始安全更新"
        onClose={() => setConfirmUpdate(false)}
        onConfirm={startUpdate}
      />
    </div>
  );
}
