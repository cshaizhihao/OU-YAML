import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { api } from "../api";
import type { SessionUser } from "../shared/types";

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api.login(username, password); onLogin(result); }
    catch (value) { setError(value instanceof Error ? value.message : "登录失败"); }
    finally { setBusy(false); }
  }

  return <main className="login-page">
    <section className="login-brand" aria-label="OU-YAML">
      <div className="brand-mark large"><img src="/brand/ou-yaml-logo.png" alt="OU-YAML" /></div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1>OU-YAML</h1>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(99, 102, 241, 0.2)", border: "1px solid rgba(99, 102, 241, 0.4)", color: "#a5b4fc" }}>V2.1.1</span>
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
        <div className="form-heading"><LockKeyhole size={22} /><div><h2>登录工作台</h2><p>使用安装时设置的管理员账号</p></div></div>
        <label>账号<input type="text" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>密码<div className="password-field"><input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="icon-button compact" onClick={() => setShow(!show)} aria-label={show ? "隐藏密码" : "显示密码"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="primary-button login-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <LockKeyhole size={18} />}登录</button>
      </form>
    </section>
  </main>;
}
