import React from "react";

// 常见国家和地区双字母代码对应的微型精致 SVG 图标路径或矢量定义
const flagSvgs: Record<string, React.ReactNode> = {
  CN: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#de2910" />
      <polygon points="6,3 7.8,8.7 3,5.2 9,5.2 4.2,8.7" fill="#ffde00" />
      <polygon points="12,1.5 12.6,3.4 11,2.2 13,2.2 11.4,3.4" fill="#ffde00" />
      <polygon points="14.4,3.6 15,5.5 13.4,4.3 15.4,4.3 13.8,5.5" fill="#ffde00" />
      <polygon points="14.4,7.2 15,9.1 13.4,7.9 15.4,7.9 13.8,9.1" fill="#ffde00" />
      <polygon points="12,9.3 12.6,11.2 11,10 13,10 11.4,11.2" fill="#ffde00" />
    </svg>
  ),
  HK: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#de2910" />
      <circle cx="18" cy="12" r="5.5" fill="none" stroke="#ffffff" strokeWidth="1.5" />
      <path d="M18 7.5 C19 9.5 19 14.5 18 16.5 M13.5 12 C15.5 13 20.5 13 22.5 12" stroke="#ffffff" strokeWidth="1.2" fill="none" />
    </svg>
  ),
  TW: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#fe0000" />
      <rect width="18" height="12" fill="#000095" />
      <circle cx="9" cy="6" r="3" fill="#ffffff" />
    </svg>
  ),
  JP: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#ffffff" />
      <circle cx="18" cy="12" r="6" fill="#bc002d" />
    </svg>
  ),
  SG: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="12" fill="#ed2939" />
      <rect y="12" width="36" height="12" fill="#ffffff" />
      <circle cx="8" cy="6" r="3.5" fill="#ffffff" />
      <circle cx="9" cy="6" r="3.2" fill="#ed2939" />
    </svg>
  ),
  US: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#b22234" />
      <rect y="2" width="36" height="2" fill="#ffffff" />
      <rect y="6" width="36" height="2" fill="#ffffff" />
      <rect y="10" width="36" height="2" fill="#ffffff" />
      <rect y="14" width="36" height="2" fill="#ffffff" />
      <rect y="18" width="36" height="2" fill="#ffffff" />
      <rect y="22" width="36" height="2" fill="#ffffff" />
      <rect width="15" height="13" fill="#3c3b6e" />
    </svg>
  ),
  KR: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#ffffff" />
      <circle cx="18" cy="12" r="5" fill="#cd2e3a" />
      <path d="M13,12 A5,5 0 0,0 23,12 A2.5,2.5 0 0,1 18,12 A2.5,2.5 0 0,0 13,12" fill="#0047a0" />
    </svg>
  ),
  DE: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="8" fill="#000000" />
      <rect y="8" width="36" height="8" fill="#dd0000" />
      <rect y="16" width="36" height="8" fill="#ffce00" />
    </svg>
  ),
  GB: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#012169" />
      <path d="M0,0 L36,24 M36,0 L0,24" stroke="#ffffff" strokeWidth="4" />
      <path d="M0,0 L36,24 M36,0 L0,24" stroke="#c8102e" strokeWidth="2.5" />
      <path d="M18,0 V24 M0,12 H36" stroke="#ffffff" strokeWidth="6" />
      <path d="M18,0 V24 M0,12 H36" stroke="#c8102e" strokeWidth="3.6" />
    </svg>
  ),
  FR: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="12" height="24" fill="#002395" />
      <rect x="12" width="12" height="24" fill="#ffffff" />
      <rect x="24" width="12" height="24" fill="#ed2939" />
    </svg>
  ),
  RU: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="8" fill="#ffffff" />
      <rect y="8" width="36" height="8" fill="#0039a6" />
      <rect y="16" width="36" height="8" fill="#d52b1e" />
    </svg>
  ),
  CA: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="9" height="24" fill="#ff0000" />
      <rect x="9" width="18" height="24" fill="#ffffff" />
      <rect x="27" width="9" height="24" fill="#ff0000" />
      <polygon points="18,5 19.5,9.5 23.5,9.5 20.5,12 21.5,16 18,13.5 14.5,16 15.5,12 12.5,9.5 16.5,9.5" fill="#ff0000" />
    </svg>
  ),
  AU: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="24" fill="#00008b" />
      <rect width="18" height="12" fill="#012169" />
      <path d="M0,0 L18,12 M18,0 L0,12" stroke="#ffffff" strokeWidth="2" />
      <path d="M9,0 V12 M0,6 H18" stroke="#ffffff" strokeWidth="3" />
      <path d="M9,0 V12 M0,6 H18" stroke="#c8102e" strokeWidth="1.8" />
    </svg>
  ),
  IN: (
    <svg viewBox="0 0 36 24" width="18" height="12" style={{ borderRadius: 2 }}>
      <rect width="36" height="8" fill="#ff9933" />
      <rect y="8" width="36" height="8" fill="#ffffff" />
      <rect y="16" width="36" height="8" fill="#128807" />
      <circle cx="18" cy="12" r="3" fill="none" stroke="#000080" strokeWidth="0.8" />
    </svg>
  )
};

// 将 Unicode 区域指示字符（Flag Emoji）转换为双字母国家代码
export function emojiToCountryCode(emoji: string): string | null {
  if (!emoji || emoji.length < 2) return null;
  const chars = [...emoji];
  if (chars.length < 2) return null;
  const codePoints = chars.slice(0, 2).map((c) => c.codePointAt(0) || 0);
  if (codePoints[0] >= 0x1f1e6 && codePoints[0] <= 0x1f1ff && codePoints[1] >= 0x1f1e6 && codePoints[1] <= 0x1f1ff) {
    return String.fromCharCode(codePoints[0] - 0x1f1e6 + 65, codePoints[1] - 0x1f1e6 + 65);
  }
  return null;
}

// 从节点名称中解析出国家代码与干净名称
export function parseNodeCountry(name: string): { countryCode: string | null; cleanName: string } {
  if (!name) return { countryCode: null, cleanName: "" };
  let str = name.trim();

  // 1. 尝试匹配前缀的 Emoji 国旗
  const chars = [...str];
  if (chars.length >= 2) {
    const code = emojiToCountryCode(chars.slice(0, 2).join(""));
    if (code) {
      str = chars.slice(2).join("").replace(/^[\s·|｜\-—]+/, "").trim();
      return { countryCode: code, cleanName: str || name };
    }
  }

  // 2. 尝试匹配显式文本国家代码前缀，例如 "CN [HK] ...", "HK 【HK】...", "[JP] ..."
  const textMatch = str.match(/^([A-Z]{2})[\s·|｜\-—]+/i) || str.match(/^[【\[]([A-Z]{2})[】\]][\s·|｜\-—]*/i);
  if (textMatch && textMatch[1]) {
    const code = textMatch[1].toUpperCase();
    if (code in flagSvgs) {
      const clean = str.slice(textMatch[0].length).trim();
      return { countryCode: code, cleanName: clean || str };
    }
  }

  // 3. 常见中文地名或地标关键词推导
  const regionMap: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /(?:香港|HK|Hong\s*Kong)/i, code: "HK" },
    { pattern: /(?:台湾|台北|TW|Taiwan)/i, code: "TW" },
    { pattern: /(?:日本|东京|大阪|JP|Japan)/i, code: "JP" },
    { pattern: /(?:新加坡|狮城|SG|Singapore)/i, code: "SG" },
    { pattern: /(?:美国|洛杉矶|圣何塞|硅谷|纽约|US|USA|United\s*States)/i, code: "US" },
    { pattern: /(?:韩国|首尔|KR|Korea)/i, code: "KR" },
    { pattern: /(?:德国|法兰克福|DE|Germany)/i, code: "DE" },
    { pattern: /(?:英国|伦敦|GB|UK|Britain)/i, code: "GB" },
    { pattern: /(?:法国|巴黎|FR|France)/i, code: "FR" },
    { pattern: /(?:俄罗斯|莫斯科|RU|Russia)/i, code: "RU" },
    { pattern: /(?:加拿大|CA|Canada)/i, code: "CA" },
    { pattern: /(?:澳大利亚|澳洲|悉尼|AU|Australia)/i, code: "AU" },
    { pattern: /(?:印度|IN|India)/i, code: "IN" },
    { pattern: /(?:中国|大陆|CN|China)/i, code: "CN" }
  ];

  for (const item of regionMap) {
    if (item.pattern.test(str)) {
      return { countryCode: item.code, cleanName: str };
    }
  }

  return { countryCode: null, cleanName: str };
}

// 统一高质感彩色国旗组件
export function CountryFlag({ code, size = "md" }: { code?: string | null; size?: "sm" | "md" | "lg" }) {
  if (!code) return null;
  const upper = code.toUpperCase();
  const svg = flagSvgs[upper];

  return (
    <span
      className={`country-flag-badge flag-${size}`}
      title={upper}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        flexShrink: 0,
        verticalAlign: "middle",
        background: "rgba(255, 255, 255, 0.05)",
        padding: "1px 2px",
      }}
    >
      {svg || <span style={{ fontSize: "10px", fontWeight: 700, padding: "0 3px", color: "#cbd5e1" }}>{upper}</span>}
    </span>
  );
}

export const COMMON_FLAG_LIST: Array<{ code: string; name: string; emoji: string }> = [
  { code: "HK", name: "中国香港", emoji: "🇭🇰" },
  { code: "TW", name: "中国台湾", emoji: "🇹🇼" },
  { code: "JP", name: "日本", emoji: "🇯🇵" },
  { code: "SG", name: "新加坡", emoji: "🇸🇬" },
  { code: "US", name: "美国", emoji: "🇺🇸" },
  { code: "KR", name: "韩国", emoji: "🇰🇷" },
  { code: "DE", name: "德国", emoji: "🇩🇪" },
  { code: "GB", name: "英国", emoji: "🇬🇧" },
  { code: "FR", name: "法国", emoji: "🇫🇷" },
  { code: "RU", name: "俄罗斯", emoji: "🇷🇺" },
  { code: "CA", name: "加拿大", emoji: "🇨🇦" },
  { code: "AU", name: "澳大利亚", emoji: "🇦🇺" },
  { code: "CN", name: "中国大陆", emoji: "🇨🇳" },
  { code: "IN", name: "印度", emoji: "🇮🇳" },
];

export function replaceNodeCountry(oldName: string, newCode: string | null): string {
  const { cleanName } = parseNodeCountry(oldName);
  if (!newCode) return cleanName;
  return `[${newCode.toUpperCase()}] · ${cleanName}`;
}

// 智能格式化节点名称，消除 Windows 黑框并渲染真实 SVG 国旗
export function FormattedNodeName({
  name,
  className = "",
  onFlagClick,
}: {
  name: string;
  className?: string;
  onFlagClick?: (event: React.MouseEvent) => void;
}) {
  const { countryCode, cleanName } = parseNodeCountry(name);

  return (
    <span className={`formatted-node-name ${className}`} style={{ display: "inline-flex", alignItems: "center", gap: "7px", maxWidth: "100%", overflow: "hidden" }}>
      {countryCode ? (
        onFlagClick ? (
          <button
            type="button"
            className="node-flag-trigger"
            onClick={(e) => {
              e.stopPropagation();
              onFlagClick(e);
            }}
            title={`当前国家/地区：${countryCode}，点击更换`}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              lineHeight: 1,
            }}
          >
            <CountryFlag code={countryCode} />
          </button>
        ) : (
          <CountryFlag code={countryCode} />
        )
      ) : onFlagClick ? (
        <button
          type="button"
          className="node-flag-trigger empty-flag"
          onClick={(e) => {
            e.stopPropagation();
            onFlagClick(e);
          }}
          title="点击选择或识别国家/地区国旗"
          style={{
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px dashed var(--line-strong)",
            borderRadius: "4px",
            padding: "2px 5px",
            fontSize: "10.5px",
            color: "var(--ink-faint)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            lineHeight: 1,
          }}
        >
          🏳️ 选地区
        </button>
      ) : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
        {cleanName}
      </span>
    </span>
  );
}
