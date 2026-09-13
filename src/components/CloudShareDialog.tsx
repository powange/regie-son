import { useState } from "react";
import { X, Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";


interface Props {
  status: "uploading" | "done" | "error";
  code: string | null;
  error: string | null;
  onClose: () => void;
}

export default function CloudShareDialog({ status, code, error, onClose }: Props) {
  const { t } = useTranslation(["share", "common"]);
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="modal-overlay" onClick={status !== "uploading" ? onClose : undefined}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{t("share:cloudShare.title")}</h2>
          {status !== "uploading" && (
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          )}
        </div>

        {status === "uploading" && (
          <div className="cloud-status">
            <Loader2 size={20} className="spin" />
            <span>{t("share:cloudShare.uploading")}</span>
          </div>
        )}

        {status === "done" && code && (
          <>
            <p className="cloud-code-caption">
              {t("share:cloudShare.caption")}
            </p>
            <div className="cloud-code-display" onClick={copyCode} title={t("share:cloudShare.clickToCopy")}>
              <span className="cloud-code-value">{code}</span>
              <button className="btn-icon" onClick={copyCode} title={t("share:cloudShare.copy")}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
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

        {status !== "uploading" && (
          <div className="modal-actions">
            <button className="btn-primary" onClick={onClose}>{t("common:actions.close")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
