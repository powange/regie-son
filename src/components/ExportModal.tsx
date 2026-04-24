import { Download, Cloud, X } from "lucide-react";

export type ExportKind = "project" | "numero";

interface Props {
  kind: ExportKind;
  onSelectFile: () => void;
  onSelectCloud: () => void;
  onClose: () => void;
}

export default function ExportModal({ kind, onSelectFile, onSelectCloud, onClose }: Props) {
  const isProject = kind === "project";
  const title = isProject ? "Exporter le spectacle" : "Exporter le numéro";
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
            <Download size={22} />
            <div className="part-option-text">
              <strong>Exporter en fichier {extLabel}</strong>
              <span>Enregistrer une archive sur le disque pour la partager manuellement.</span>
            </div>
          </button>
          <button className="source-option part-option" onClick={() => pick(onSelectCloud)}>
            <Cloud size={22} />
            <div className="part-option-text">
              <strong>Partager sur le cloud</strong>
              <span>Téléverser l'archive et obtenir un code à transmettre.</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
