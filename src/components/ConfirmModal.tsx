import { useId } from "react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";

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
  const messageId = useId();

  return (
    <Modal title={title} onClose={onCancel} role="alertdialog" describedBy={messageId} style={{ maxWidth: 440 }}>
      <p id={messageId}>{message}</p>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onCancel} autoFocus>{t("common:actions.cancel")}</button>
        <button className="btn-danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
