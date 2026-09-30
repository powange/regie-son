import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModal } from "../useModal";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// In-app rather than a native dialog: it does not freeze the webview's
// JavaScript (fades, pause countdown) while it waits for an answer.
export default function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation(["common"]);
  useModal(onCancel);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 440 }} role="alertdialog" aria-modal="true">
        <div className="modal-title-row">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onCancel}><X size={16} /></button>
        </div>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel} autoFocus>{t("common:actions.cancel")}</button>
          <button className="btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
