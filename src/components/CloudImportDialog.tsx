import { useState } from "react";
import { X, Cloud, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  kind: "project" | "numero";
  onSubmit: (code: string) => Promise<void>;
  onClose: () => void;
}

export default function CloudImportDialog({ kind, onSubmit, onClose }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = kind === "project" ? "Récupérer un spectacle" : "Récupérer un numéro";

  async function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed) { setError("Veuillez saisir un code."); return; }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      // Le modal reste ouvert pendant la descente ; le parent le ferme via onClose après succès.
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{title}</h2>
          {!busy && <button className="btn-icon" onClick={onClose}><X size={16} /></button>}
        </div>

        <div className="modal-field">
          <label>Code de partage</label>
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="Ex : AbCdEf12"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleSubmit()}
          />
        </div>

        {busy && (
          <div className="cloud-status">
            <Loader2 size={18} className="spin" />
            <span>Téléchargement et extraction en cours…</span>
          </div>
        )}

        {error && !busy && (
          <div className="cloud-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={busy || !code.trim()}>
            <Cloud size={14} />
            Récupérer
          </button>
        </div>
      </div>
    </div>
  );
}
