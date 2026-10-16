import { getTurnstileConfig } from "./db";

export async function verifyTurnstileToken(
  token?: string,
  remoteIp?: string
): Promise<{ success: boolean; error?: string }> {
  const config = getTurnstileConfig();

  // 如果管理员未开启或未配置 Secret Key，直接跳过人机验证，允许正常通过
  if (!config.enabled || !config.secretKey) {
    return { success: true };
  }

  // 如果开启了但客户端未提交 token
  if (!token || typeof token !== "string" || !token.trim()) {
    return { success: false, error: "请先完成 Cloudflare 人机安全验证盾" };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", config.secretKey);
    formData.append("response", token.trim());
    if (remoteIp) {
      // 若是本地环回或者包含端口，做基础处理
      const cleanIp = remoteIp.replace(/^::ffff:/, "");
      if (cleanIp && cleanIp !== "127.0.0.1" && cleanIp !== "::1") {
        formData.append("remoteip", cleanIp);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      console.warn(`[Turnstile] Cloudflare 验证接口响应非200: ${response.status}`);
      return { success: false, error: `Cloudflare 验证服务异常（HTTP ${response.status}）` };
    }

    const result = (await response.json()) as {
      success: boolean;
      "error-codes"?: string[];
      hostname?: string;
    };

    if (result.success) {
      return { success: true };
    }

    console.warn("[Turnstile] 验证未通过:", result["error-codes"]);
    const errorCodes = result["error-codes"] || [];
    if (errorCodes.includes("invalid-input-secret")) {
      return { success: false, error: "Cloudflare Turnstile 通信密钥 (Secret Key) 无效，请管理员检查设置" };
    }
    if (errorCodes.includes("timeout-or-duplicate")) {
      return { success: false, error: "人机验证已失效或超时，请重新验证" };
    }

    return { success: false, error: "人机安全验证失败，请重新尝试" };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    console.error("[Turnstile] 验证请求发生异常:", err);
    if (isAbort) {
      return { success: false, error: "连接 Cloudflare 验证服务超时，请检查网络" };
    }
    return { success: false, error: "人机验证服务网络故障，请稍后重试" };
  }
}
