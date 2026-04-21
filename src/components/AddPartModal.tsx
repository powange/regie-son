import { ListMusic, Coffee, MicVocal, Upload, X } from "lucide-react";

interface Props {
  onSelectNumero: () => void;
  onSelectEntracte: () => void;
  onSelectPresentation: () => void;
  onSelectImport: () => void;
  onClose: () => void;
}

export default function AddPartModal({
  onSelectNumero,
  onSelectEntracte,
  onSelectPresentation,
  onSelectImport,
  onClose,
}: Props) {
  function pick(handler: () => void) {
    onClose();
    handler();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Ajouter une partie</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="source-list">
          <button className="source-option part-option part-option--numero" onClick={() => pick(onSelectNumero)}>
            <ListMusic size={22} />
            <div className="part-option-text">
              <strong>Numéro</strong>
              <span>Un passage avec ses musiques et ses pauses.</span>
            </div>
          </button>
          <button className="source-option part-option part-option--numero" onClick={() => pick(onSelectImport)}>
            <Upload size={22} />
            <div className="part-option-text">
              <strong>Importer un numéro</strong>
              <span>Depuis un fichier .regiesonnumero exporté.</span>
            </div>
          </button>
          <button className="source-option part-option part-option--entracte" onClick={() => pick(onSelectEntracte)}>
            <Coffee size={22} />
            <div className="part-option-text">
              <strong>Entracte</strong>
              <span>Une pause entre deux moments du spectacle.</span>
            </div>
          </button>
          <button className="source-option part-option part-option--presentation" onClick={() => pick(onSelectPresentation)}>
            <MicVocal size={22} />
            <div className="part-option-text">
              <strong>Présentation</strong>
              <span>Un moment d'annonce ou de transition.</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
