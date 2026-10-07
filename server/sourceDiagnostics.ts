import { safeFetchSubscription, type FetchDiagnostic } from "./safeFetch";
import { parseImportedContent, type ImportFormat } from "./importer";

export function diagnosticAdvice(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/404/.test(message)) return "服务器确认返回 404。检查订阅是否过期、客户端专用参数是否完整，以及服务端是否按来源 IP 限制访问。";
  if (/401|403/.test(message)) return "订阅服务拒绝访问。检查有效期、访问权限和机场的 IP 限制，不要使用网页登录地址代替订阅。";
  if (/certificate|cert_|tls|ssl/i.test(message)) return "TLS 证书校验失败。请先修复订阅服务证书或检查服务器系统时间。";
  if (/html/i.test(message)) return "返回的是网页而不是订阅，可能有登录、验证码或 Cloudflare 挑战。请使用客户端专用订阅地址。";
  if (/timeout|超时|aborted/i.test(message)) return "请求超时。检查服务器 DNS、IPv4/IPv6 出站网络和订阅服务器的可达性。";
  if (/局域网|非公网|HTTP 或 HTTPS|格式无效/.test(message)) return "地址不符合要求：请使用可公开访问的 HTTP/HTTPS 订阅，不要填写本机或局域网地址。";
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return "无法解析订阅域名，请检查 DNS 和域名拼写。";
  return "未能完成订阅解析。检查链接和内容格式，必要时在客户端重新获取订阅。";
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
