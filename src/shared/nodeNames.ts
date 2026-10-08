const leadingFlags = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}[\s·|｜-]*)+/u;

export function addCountryFlag(name: string, flag: string, maxLength = 160) {
  if (!/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(flag)) throw new Error("国家或地区国旗无效");
  if (maxLength < flag.length + 2) throw new Error("节点名称长度限制无效");
  const body = name.trim().replace(leadingFlags, "").trim() || "节点";
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
