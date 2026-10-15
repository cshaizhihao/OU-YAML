import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, UserPlus, LogIn, Sparkles } from "lucide-react";
import { api } from "../api";
import type { SessionUser } from "../shared/types";

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (tab === "register") {
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致，请核对");
        return;
      }
      if (password.length < 10) {
        setError("密码长度至少需要 10 位");
        return;
      }
      setBusy(true);
      try {
        const result = await api.register(username, password);
        onLogin(result);
      } catch (value) {
        setError(value instanceof Error ? value.message : "注册失败，请稍后重试");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await api.login(username, password);
      onLogin(result);
    } catch (value) {
      setError(value instanceof Error ? value.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="OU-YAML">
        <div className="brand-mark large">
          <img src="/brand/ou-yaml-logo.png" alt="OU-YAML" />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1>OU-YAML</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(99, 102, 241, 0.2)", border: "1px solid rgba(99, 102, 241, 0.4)", color: "#a5b4fc" }}>
              V2.1.2
            </span>
          </div>
          <p>Mihomo / Clash Meta 可视化配置工作室</p>
        </div>
        <div className="config-lines" aria-hidden="true">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span style={{ fontSize: 10.5, color: "var(--ink-faint)", marginLeft: 6, fontFamily: "ui-monospace, monospace" }}>config.yaml</span>
          </div>
          <span><i />mixed-port: 7890</span>
          <span><i />allow-lan: true</span>
          <span><i />mode: rule</span>
          <span><i />proxy-groups:</span>
          <span className="indent"><i />- name: 🚀 节点选择</span>
          <span className="indent"><i />type: select</span>
          <span className="indent"><i />- name: 🐟 漏网之鱼</span>
          <span className="indent"><i />type: select</span>
        </div>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div className="login-tabs" role="tablist">
            <button
              type="button"
              className={`login-tab-btn${tab === "login" ? " active" : ""}`}
              onClick={() => { setTab("login"); setError(""); }}
              role="tab"
              aria-selected={tab === "login"}
            >
              <LogIn size={15} /> 登录已有账号
            </button>
            <button
              type="button"
              className={`login-tab-btn${tab === "register" ? " active" : ""}`}
              onClick={() => { setTab("register"); setError(""); setUsername(""); setPassword(""); setConfirmPassword(""); }}
              role="tab"
              aria-selected={tab === "register"}
            >
              <UserPlus size={15} /> 注册新用户
            </button>
          </div>

          <div className="form-heading">
            {tab === "login" ? <LockKeyhole size={22} /> : <Sparkles size={22} />}
            <div>
              <h2>{tab === "login" ? "登录工作台" : "创建专属账号"}</h2>
              <p>{tab === "login" ? "使用管理员或普通用户账号" : "独立拥有专属订阅来源、节点与配置发布"}</p>
            </div>
          </div>

          <label>
            账号
            <input
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              placeholder={tab === "register" ? "3-64位字母、数字或 ._-" : "输入登录账号"}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label>
            密码
            <div className="password-field">
              <input
                type={show ? "text" : "password"}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                value={password}
                placeholder={tab === "register" ? "至少 10 位安全密码" : "输入密码"}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="icon-button compact"
                onClick={() => setShow(!show)}
                aria-label={show ? "隐藏密码" : "显示密码"}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {tab === "register" && (
            <label>
              确认密码
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  placeholder="再次输入上述密码"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </label>
          )}

          {error && <div className="form-error" role="alert">{error}</div>}

          <button type="submit" className="primary-button login-button" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : tab === "login" ? (
              <LogIn size={18} />
            ) : (
              <UserPlus size={18} />
            )}
            {busy ? (tab === "login" ? "正在登录…" : "正在创建账号…") : (tab === "login" ? "登录" : "立即注册并进入")}
          </button>
        </form>
      </section>
    </main>
  );
}
