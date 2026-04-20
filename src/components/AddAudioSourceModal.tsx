import { Monitor, X } from "lucide-react";

interface Props {
  onSelectLocal: () => void;
  onClose: () => void;
}

export default function AddAudioSourceModal({ onSelectLocal, onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Ajouter une musique</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="source-list">
          <button
            className="source-option"
            onClick={() => { onClose(); onSelectLocal(); }}
          >
            <Monitor size={20} />
            <span>Cet ordinateur</span>
          </button>
        </div>
      </div>
    </div>
  );
}
