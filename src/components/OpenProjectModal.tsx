import { FolderOpen, FileInput, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";


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
    <Modal title={title} onClose={onClose} style={{ maxWidth: 440 }}>

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
    </Modal>
  );
}
