import { useEffect, useRef, useState } from "react";
import { Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";


interface Props {
  status: "uploading" | "done" | "error";
  code: string | null;
  error: string | null;
  // Closing never cancels an upload: there is no way to stop it on the Rust
  // side, so it goes on in the background and the editor reports its outcome.
  onClose: () => void;
}

export default function CloudShareDialog({ status, code, error, onClose }: Props) {
  const { t } = useTranslation(["share", "common"]);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyFailed(false);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <Modal title={t("share:cloudShare.title")} onClose={onClose} style={{ maxWidth: 440 }}>

        {status === "uploading" && (
          <>
            <div className="cloud-status">
              <Loader2 size={20} className="spin" />
              <span>{t("share:cloudShare.uploading")}</span>
            </div>
            <p className="cloud-code-hint">{t("share:cloudShare.backgroundHint")}</p>
          </>
        )}

        {status === "done" && code && (
          <>
            <p className="cloud-code-caption">
              {t("share:cloudShare.caption")}
            </p>
            <div className="cloud-code-display" onClick={copyCode} title={t("share:cloudShare.clickToCopy")}>
              <span className="cloud-code-value">{code}</span>
              <button className="btn-icon" onClick={(e) => { e.stopPropagation(); void copyCode(); }} title={t("share:cloudShare.copy")}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            {copyFailed && <p className="modal-error" role="alert">{t("share:cloudShare.copyFailed")}</p>}
            <p className="cloud-code-hint">
              {t("share:cloudShare.expiry")}
            </p>
          </>
        )}

        {status === "error" && (
          <div className="cloud-error">
            <AlertCircle size={16} />
            <span>{error ?? t("share:cloudShare.unknownError")}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-primary" onClick={onClose}>{t("common:actions.close")}</button>
        </div>
    </Modal>
  );
}
