import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Drawer({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      <div className="drawer-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>;
}

export function ConfirmDialog({ open, title, message, confirmText = "删除", onConfirm, onClose }: { open: boolean; title: string; message: string; confirmText?: string; onConfirm: () => void; onClose: () => void }) {
  if (!open) return null;
  return <div className="overlay centered" role="presentation"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{message}</p><div><button className="secondary-button" onClick={onClose}>取消</button><button className="danger-button" onClick={onConfirm}>{confirmText}</button></div></section></div>;
}
