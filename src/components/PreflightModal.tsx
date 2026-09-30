import { CheckCircle2, AlertTriangle, AlertCircle, MonitorPlay } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PreflightIssue } from "../preflight";
import { preflightMessage } from "../preflightMessage";
import Modal from "./Modal";

interface Props {
  issues: PreflightIssue[];
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
}

export default function PreflightModal({ issues, onClose, onConfirm, confirmLabel }: Props) {
  const { t } = useTranslation(["preflight", "common"]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const hasErrors = errors.length > 0;

  return (
    <Modal title={t("preflight:title")} onClose={onClose} style={{ maxWidth: 560 }}>

        {issues.length === 0 ? (
          <div className="preflight-ok">
            <CheckCircle2 size={18} />
            <span>{t("preflight:allGood")}</span>
          </div>
        ) : (
          <div className="preflight-list">
            {errors.map((issue, i) => (
              <div key={`e-${i}`} className="preflight-issue preflight-issue--error">
                <AlertCircle size={14} />
                <span>{preflightMessage(t, issue)}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={`w-${i}`} className="preflight-issue preflight-issue--warning">
                <AlertTriangle size={14} />
                <span>{preflightMessage(t, issue)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>{t("common:actions.close")}</button>
          {onConfirm && !hasErrors && (
            <button className="btn-primary" onClick={() => { onClose(); onConfirm(); }}>
              <MonitorPlay size={14} />
              {confirmLabel ?? t("common:actions.continue")}
            </button>
          )}
        </div>
    </Modal>
  );
}
