import { FolderOpen, Upload, Cloud, X } from "lucide-react";

export type OpenKind = "project" | "numero";

interface Props {
  kind: OpenKind;
  onSelectFolder: () => void;
  onSelectFile: () => void;
  onSelectCloud: () => void;
  onClose: () => void;
}

export default function OpenProjectModal({ kind, onSelectFolder, onSelectFile, onSelectCloud, onClose }: Props) {
  const isProject = kind === "project";
  const title = isProject ? "Ouvrir un spectacle" : "Ouvrir un numéro";
  const extLabel = isProject ? ".regieson" : ".regiesonnumero";
  const folderDesc = isProject
    ? "Choisir le dossier d'un spectacle existant."
    : "Choisir le dossier d'un numéro existant.";
  const fileDesc = `Décompresser une archive ${extLabel} dans un dossier du disque.`;
  const cloudDesc = "Saisir un code pour récupérer une archive partagée en ligne.";

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
              <strong>Un dossier sur l'ordinateur</strong>
              <span>{folderDesc}</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectFile)}>
            <Upload size={22} />
            <div className="part-option-text">
              <strong>Un fichier {extLabel}</strong>
              <span>{fileDesc}</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectCloud)}>
            <Cloud size={22} />
            <div className="part-option-text">
              <strong>Sur le cloud</strong>
              <span>{cloudDesc}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
