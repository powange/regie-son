import { FileOutput, Cloud, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModal } from "../useModal";


export type ExportKind = "project" | "numero";

interface Props {
  kind: ExportKind;
  onSelectFile: () => void;
  onSelectCloud: () => void;
  onClose: () => void;
}

export default function ExportModal({ kind, onSelectFile, onSelectCloud, onClose }: Props) {
  const { t } = useTranslation(["share"]);
  useModal(onClose);
  const isProject = kind === "project";
  const title = isProject ? t("share:export.showTitle") : t("share:export.actTitle");
  const extLabel = isProject ? ".regieson" : ".regiesonnumero";

  function pick(handler: () => void) {
    onClose();
    handler();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="source-list">
          <button className="source-option part-option" onClick={() => pick(onSelectFile)}>
            <FileOutput size={22} />
            <div className="part-option-text">
              <strong>{t("share:export.file", { ext: extLabel })}</strong>
              <span>{t("share:export.fileHint")}</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectCloud)}>
            <Cloud size={22} />
            <div className="part-option-text">
              <strong>{t("share:export.cloud")}</strong>
              <span>{t("share:export.cloudHint")}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
