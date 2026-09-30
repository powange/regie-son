import { CSSProperties, KeyboardEvent, ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModal } from "../useModal";

interface Props {
  title: ReactNode;
  onClose: () => void;
  // False while something must not be interrupted (an upload, a download):
  // Escape, the backdrop and the close button then do nothing.
  canClose?: boolean;
  // Forms the user fills in pass false: a stray click beside them must not
  // throw the input away.
  closeOnBackdrop?: boolean;
  role?: "dialog" | "alertdialog";
  describedBy?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  title, onClose, canClose = true, closeOnBackdrop = true, role = "dialog", describedBy, style, children,
}: Props) {
  const { t } = useTranslation(["common"]);
  useModal(onClose, canClose);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);

  // Focus goes into the dialog (unless a field already took it with
  // autoFocus) and back to where it was once the dialog closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    return () => {
      if (previous && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Tab cycles inside the dialog instead of reaching the page behind it.
  function trapFocus(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  // A click only closes when it both started and ended on the backdrop: a
  // drag that began in the dialog (a waveform region, a text selection) and
  // was released beside it fires its click on the backdrop too.
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const fromBackdrop = pressedOnBackdrop.current && e.target === e.currentTarget;
        pressedOnBackdrop.current = false;
        if (fromBackdrop && closeOnBackdrop && canClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        style={style}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <div className="modal-title-row">
          <h2 id={titleId}>{title}</h2>
          {canClose && (
            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              aria-label={t("common:actions.close")}
              title={t("common:actions.close")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
