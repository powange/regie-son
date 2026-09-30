import { useState } from "react";
import { Cloud, AlertCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateError } from "../errorMessage";
import Modal from "./Modal";


interface Props {
  kind: "project" | "numero";
  onSubmit: (code: string) => Promise<void>;
  onClose: () => void;
}

export default function CloudImportDialog({ kind, onSubmit, onClose }: Props) {
  const { t } = useTranslation(["share", "common"]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = kind === "project" ? t("share:import.showTitle") : t("share:import.actTitle");

  async function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed) { setError(t("share:import.codeRequired")); return; }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      // Le modal reste ouvert pendant la descente ; le parent le ferme via onClose après succès.
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} canClose={!busy} closeOnBackdrop={code.trim() === ""} style={{ maxWidth: 440 }}>

        <div className="modal-field">
          <label>{t("share:import.codeLabel")}</label>
          <input
            type="text"
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder={t("share:import.codePlaceholder")}
            autoFocus
            disabled={busy}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleSubmit()}
          />
        </div>

        {busy && (
          <div className="cloud-status">
            <Loader2 size={18} className="spin" />
            <span>{t("share:import.inProgress")}</span>
          </div>
        )}

        {error && !busy && (
          <div className="cloud-error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>{t("common:actions.cancel")}</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={busy || !code.trim()}>
            <Cloud size={14} />
            {t("share:import.submit")}
          </button>
        </div>
    </Modal>
  );
}
