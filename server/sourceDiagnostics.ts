import { safeFetchSubscription, type FetchDiagnostic } from "./safeFetch";
import { parseImportedContent, type ImportFormat } from "./importer";
import { sourceErrorAdvice } from "../src/shared/subscriptionStatus";

export function diagnosticAdvice(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return sourceErrorAdvice(message);
}

export async function diagnoseSource(source: { url?: string; format: string; userAgent?: string; skipCertVerify?: boolean }) {
  if (!source.url) throw new Error("此来源没有远程订阅地址");
  const events: FetchDiagnostic[] = [];
  try {
    const response = await safeFetchSubscription(source.url, 2_000_000, { userAgent: source.userAgent, skipCertVerify: source.skipCertVerify, onDiagnostic: (event) => { if (events.length < 80) events.push(event); } });
    const parsed = parseImportedContent(response.text, source.format as ImportFormat);
    if (!parsed.nodes.length) throw new Error("没有识别到节点");
    return { ok: true, events, nodeCount: parsed.nodes.length, advice: `已识别 ${parsed.nodes.length} 个节点${parsed.warnings.length ? `，另有 ${parsed.warnings.length} 条内容需要检查` : ""}。诊断不会修改来源或发布内容。` };
  } catch (error) { return { ok: false, events, nodeCount: 0, advice: diagnosticAdvice(error) }; }
}
