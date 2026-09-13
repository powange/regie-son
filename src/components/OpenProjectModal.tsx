import { FolderOpen, FileInput, Cloud, X } from "lucide-react";
import { useTranslation } from "react-i18next";


export type OpenKind = "project" | "numero";

interface Props {
  kind: OpenKind;
  onSelectFolder: () => void;
  onSelectFile: () => void;
  onSelectCloud: () => void;
  onClose: () => void;
}

export default function OpenProjectModal({ kind, onSelectFolder, onSelectFile, onSelectCloud, onClose }: Props) {
  const { t } = useTranslation(["share"]);
  const isProject = kind === "project";
  const title = isProject ? t("share:open.showTitle") : t("share:open.actTitle");
  const extLabel = isProject ? ".regieson" : ".regiesonnumero";
  const folderDesc = isProject
    ? t("share:open.folderShowHint")
    : t("share:open.folderActHint");
  const fileDesc = t("share:open.fileHint", { ext: extLabel });
  const cloudDesc = t("share:open.cloudHint");

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
          <button className="source-option part-option" onClick={() => pick(onSelectFolder)}>
            <FolderOpen size={22} />
            <div className="part-option-text">
              <strong>{t("share:open.folder")}</strong>
              <span>{folderDesc}</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectFile)}>
            <FileInput size={22} />
            <div className="part-option-text">
              <strong>{t("share:open.file", { ext: extLabel })}</strong>
              <span>{fileDesc}</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectCloud)}>
            <Cloud size={22} />
            <div className="part-option-text">
              <strong>{t("share:open.cloud")}</strong>
              <span>{cloudDesc}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
