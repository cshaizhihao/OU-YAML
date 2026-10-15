const leadingFlagsAndTags = /^(?:(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\[【\(〔][A-Za-z0-9\s_\-\.]{1,10}[\]】\)〕]|[A-Za-z]{2}[\s·|｜\-—:：/_]+)[\s·|｜\-—:：/_]*)+/u;

export function cleanNodeBaseName(name: string): string {
  if (!name) return "";
  let str = name.trim();
  while (leadingFlagsAndTags.test(str)) {
    str = str.replace(leadingFlagsAndTags, "").trim();
  }
  str = str.replace(/^[\s·|｜\-—:：/_]+/, "").trim();
  return str || name.trim();
}

export function addCountryFlag(name: string, flag: string, maxLength = 160) {
  if (!/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(flag)) throw new Error("国家或地区国旗无效");
  if (maxLength < flag.length + 2) throw new Error("节点名称长度限制无效");
  const body = cleanNodeBaseName(name) || "节点";
  const prefix = `${flag} `;
  let result = prefix;
  for (const character of body) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result;
}

export function countryFlagForRename(previousName: string, nextName: string) {
  const flag = nextName.match(/^[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0];
  return flag && addCountryFlag(previousName, flag) === nextName ? flag : undefined;
}
