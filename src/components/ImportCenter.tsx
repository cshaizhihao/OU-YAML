import { useRef, useState } from "react";
import { FileJson2, FileUp, Link2, LoaderCircle, Upload } from "lucide-react";
import type { MihomoConfig, TargetFormat, ValidationIssue } from "../shared/types";
import { Drawer } from "./Dialog";

type ImportResult = { config?: MihomoConfig; nodes: MihomoConfig["proxies"]; format: TargetFormat | "links"; warnings: string[]; issues: ValidationIssue[] };

export function ImportCenter({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (content: string, format: "auto" | "links" | TargetFormat, filename?: string) => Promise<ImportResult> }) {
  const [tab, setTab] = useState<"file" | "links" | "config">("file");
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const selectFile = async (file?: File) => { if (!file) return; setFilename(file.name); setContent(await file.text()); setError(""); };
  const submit = async () => {
    if (!content.trim()) { setError("请先选择文件或粘贴内容"); return; }
    setBusy(true); setError("");
    try { await onImport(content, tab === "links" ? "links" : "auto", filename); onClose(); setContent(""); setFilename(""); }
    catch (value) { setError(value instanceof Error ? value.message : "导入失败"); }
    finally { setBusy(false); }
  };
  return <Drawer title="导入中心" open={open} onClose={onClose} footer={<><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}导入</button></>}>
    <div className="segmented-control" role="tablist"><button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}><FileUp size={16} />文件</button><button className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}><Link2 size={16} />分享链接</button><button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}><FileJson2 size={16} />配置文本</button></div>
    {tab === "file" ? <div className="file-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}><input ref={input} hidden type="file" accept=".yaml,.yml,.json,.txt" onChange={(event) => selectFile(event.target.files?.[0])} /><FileUp size={26} /><strong>{filename || "选择配置文件"}</strong><button className="secondary-button" onClick={() => input.current?.click()}>选择文件</button></div> : <label className="import-textarea">{tab === "links" ? "分享链接" : "配置内容"}<textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} placeholder={tab === "links" ? "vless://...\nvmess://...\nss://..." : "粘贴 Mihomo YAML 或 sing-box JSON"} /></label>}
    {error && <div className="form-error" role="alert">{error}</div>}
  </Drawer>;
}
