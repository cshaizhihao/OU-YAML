import { useEffect, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { api } from "../../api";
import type { MihomoConfig } from "../../shared/types";

export function SourceView({ config, source, onApply }: { config: MihomoConfig; source: string; onApply: (config: MihomoConfig) => void }) {
  const [draft, setDraft] = useState(source);
  const [status, setStatus] = useState("");
  useEffect(() => setDraft(source), [source]);
  async function apply() { try { const parsed = await api.parseYaml(draft); onApply(parsed.config); setStatus("已应用"); } catch (error) { setStatus(error instanceof Error ? error.message : "解析失败"); } }
  return <div className="source-editor"><div className="source-toolbar"><span>config.yaml</span><div><button className="secondary-button compact-button" onClick={async () => { await navigator.clipboard.writeText(draft); setStatus("已复制"); }}><Copy size={15} />复制</button><button className="secondary-button compact-button" onClick={() => { setDraft(source); setStatus(""); }}><RotateCcw size={15} />重置</button><button className="primary-button compact-button" onClick={apply}><Check size={15} />应用源码</button></div></div><textarea spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="YAML 源码" />{status && <div className="source-status" role="status">{status}</div>}</div>;
}
