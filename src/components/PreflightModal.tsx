import { CheckCircle2, AlertTriangle, AlertCircle, X, MonitorPlay } from "lucide-react";
import { PreflightIssue } from "../preflight";

interface Props {
  issues: PreflightIssue[];
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
}

export default function PreflightModal({ issues, onClose, onConfirm, confirmLabel }: Props) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const hasErrors = errors.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Vérification du spectacle</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {issues.length === 0 ? (
          <div className="preflight-ok">
            <CheckCircle2 size={18} />
            <span>Tout est bon, aucune anomalie détectée.</span>
          </div>
        ) : (
          <div className="preflight-list">
            {errors.map((issue, i) => (
              <div key={`e-${i}`} className="preflight-issue preflight-issue--error">
                <AlertCircle size={14} />
                <span>{issue.message}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={`w-${i}`} className="preflight-issue preflight-issue--warning">
                <AlertTriangle size={14} />
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Fermer</button>
          {onConfirm && !hasErrors && (
            <button className="btn-primary" onClick={() => { onClose(); onConfirm(); }}>
              <MonitorPlay size={14} />
              {confirmLabel ?? "Continuer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
