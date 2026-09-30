import { FileOutput, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";


export type ExportKind = "project" | "numero";

interface Props {
  kind: ExportKind;
  onSelectFile: () => void;
  onSelectCloud: () => void;
  onClose: () => void;
}

export default function ExportModal({ kind, onSelectFile, onSelectCloud, onClose }: Props) {
  const { t } = useTranslation(["share"]);
  const isProject = kind === "project";
  const title = isProject ? t("share:export.showTitle") : t("share:export.actTitle");
  const extLabel = isProject ? ".regieson" : ".regiesonnumero";

  function pick(handler: () => void) {
    onClose();
    handler();
  }

  return (
    <Modal title={title} onClose={onClose} style={{ maxWidth: 440 }}>

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
    </Modal>
  );
}
