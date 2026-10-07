import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

function useModalFocus(open: boolean, onClose: () => void, dialogRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex=\"-1\"])")];
    window.setTimeout(() => (focusable()[0] || dialog).focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); return; }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open, onClose, dialogRef]);
}

export function Drawer({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(open, onClose, dialogRef);
  if (!open) return null;
  return <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      <div className="drawer-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>;
}

export function ConfirmDialog({ open, title, message, confirmText = "删除", onConfirm, onClose }: { open: boolean; title: string; message: string; confirmText?: string; onConfirm: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalFocus(open, onClose, dialogRef);
  if (!open) return null;
  return <div className="overlay centered" role="presentation"><section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1}><h2 id="confirm-title">{title}</h2><p>{message}</p><div><button className="secondary-button" onClick={onClose}>取消</button><button className="danger-button" onClick={onConfirm}>{confirmText}</button></div></section></div>;
}
