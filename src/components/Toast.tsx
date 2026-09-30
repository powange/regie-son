import { useEffect } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ToastData {
  // A new id restarts the auto-hide timer even when the text is the same.
  id: number;
  kind: "error" | "info";
  message: string;
  action?: { label: string; run: () => void };
}

let nextId = 1;
export function makeToast(kind: ToastData["kind"], message: string, action?: ToastData["action"]): ToastData {
  return { id: nextId++, kind, message, action };
}

const INFO_TIMEOUT_MS = 6000;

// Replaces alert(): a native dialog suspends the webview's JavaScript, which
// froze fades, the pause countdown and the progress until it was dismissed.
// Errors stay until closed; information fades out on its own.
export default function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const { t } = useTranslation(["common"]);

  useEffect(() => {
    if (toast.kind !== "info") return;
    const timer = setTimeout(onDismiss, INFO_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.kind]);

  return (
    <div className={`toast toast--${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { toast.action?.run(); onDismiss(); }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="btn-icon"
        onClick={onDismiss}
        aria-label={t("common:actions.close")}
        title={t("common:actions.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
