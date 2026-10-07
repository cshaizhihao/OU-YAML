export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
  const element = document.createElement("textarea");
  element.value = value;
  element.style.position = "fixed";
  element.style.opacity = "0";
  document.body.appendChild(element);
  element.select();
  const copied = document.execCommand("copy");
  element.remove();
  if (!copied) throw new Error("自动复制不可用，请选中链接手动复制");
}
