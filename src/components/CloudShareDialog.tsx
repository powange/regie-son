import { useState } from "react";
import { X, Copy, Check, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  status: "uploading" | "done" | "error";
  code: string | null;
  error: string | null;
  onClose: () => void;
}

export default function CloudShareDialog({ status, code, error, onClose }: Props) {
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
          <h2>Partage cloud</h2>
          {status !== "uploading" && (
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          )}
        </div>

        {status === "uploading" && (
          <div className="cloud-status">
            <Loader2 size={20} className="spin" />
            <span>Téléversement en cours…</span>
          </div>
        )}

        {status === "done" && code && (
          <>
            <p className="cloud-code-caption">
              Communiquez ce code pour que votre destinataire récupère l'archive :
            </p>
            <div className="cloud-code-display" onClick={copyCode} title="Cliquer pour copier">
              <span className="cloud-code-value">{code}</span>
              <button className="btn-icon" onClick={copyCode} title="Copier">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <p className="cloud-code-hint">
              Hébergé sur Litterbox — le fichier expire automatiquement au bout de 72 heures.
            </p>
          </>
        )}

        {status === "error" && (
          <div className="cloud-error">
            <AlertCircle size={16} />
            <span>{error ?? "Erreur inconnue"}</span>
          </div>
        )}

        {status !== "uploading" && (
          <div className="modal-actions">
            <button className="btn-primary" onClick={onClose}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}
