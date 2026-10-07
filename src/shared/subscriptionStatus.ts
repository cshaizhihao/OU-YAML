import type { GeneratedSubscription, GenerationProfile, NodeSource } from "./domain";

export function sourceErrorAdvice(message: string) {
  if (/404/.test(message)) return "检查订阅是否过期、专用参数是否完整，以及机场是否限制服务器 IP；不要仅凭 404 更换发布地址。";
  if (/401|403/.test(message)) return "重新获取客户端专用订阅，确认权限、有效期及机场的 IP 限制。";
  if (/certificate|cert_|tls|ssl/i.test(message)) return "检查订阅服务证书和服务器时间，不建议直接关闭证书校验。";
  if (/html/i.test(message)) return "返回的是网页，可能有登录或验证码。请使用客户端专用订阅地址。";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "无法解析域名，请检查域名拼写和服务器 DNS。";
  if (/timeout|超时|aborted/i.test(message)) return "检查服务器出站网络、DNS 和订阅服务是否可达，再重试。";
  if (/局域网|非公网|HTTP 或 HTTPS|格式无效/.test(message)) return "请使用可公开访问的 HTTP/HTTPS 订阅，不能填写本机或局域网地址。";
  return "打开来源诊断查看原因，确认链接和格式后重试。";
}

export function subscriptionStatus(item: GeneratedSubscription, profile: GenerationProfile | undefined, sources: NodeSource[], now = Date.now()) {
  if (item.revoked) return { tone: "danger", label: "链接已撤销", available: false, detail: "此地址不能恢复，请重新发布并在客户端替换链接。" };
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= now) return { tone: "warning", label: "链接已过期", available: false, detail: "请重新发布或在高级发布中调整有效期，再刷新客户端。" };
  if (!profile) return { tone: "warning", label: "方案已删除", available: true, detail: "已发布内容仍可获取，但无法继续同步。请重新建立生成方案。" };
  if (profile.lastSyncError) return { tone: "warning", label: "同步需要处理", available: true, detail: "上次发布内容仍保留。请检查节点和配置校验后重试；链接可获取不代表节点一定连通。" };
  if (sources.some((source) => profile.sourceIds.includes(source.id) && source.lastError)) return { tone: "warning", label: "来源更新失败", available: true, detail: "已导入节点和上次发布内容仍保留。先诊断来源，无需重置客户端地址。" };
  return { tone: "success", label: "链接可获取", available: true, detail: "公开地址未过期、未撤销；节点实际可用性请在节点库进行代理实测。" };
}
