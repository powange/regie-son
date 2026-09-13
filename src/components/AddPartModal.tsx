import { ListMusic, Coffee, MicVocal, FileInput, Cloud, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  onSelectNumero: () => void;
  onSelectEntracte: () => void;
  onSelectPresentation: () => void;
  onSelectImport: () => void;
  onSelectImportCloud: () => void;
  onClose: () => void;
}

export default function AddPartModal({
  onSelectNumero,
  onSelectEntracte,
  onSelectPresentation,
  onSelectImport,
  onSelectImportCloud,
  onClose,
}: Props) {
  const { t } = useTranslation(["parts", "editor"]);

  function pick(handler: () => void) {
    onClose();
    handler();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{t("editor:addPart")}</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="source-list">
          <button className="source-option part-option part-option--numero" onClick={() => pick(onSelectNumero)}>
            <ListMusic size={22} />
            <div className="part-option-text">
              <strong>{t("parts:act.label")}</strong>
              <span>{t("parts:act.hint")}</span>
            </div>
          </button>
          <button className="source-option part-option part-option--numero" onClick={() => pick(onSelectImport)}>
            <FileInput size={22} />
            <div className="part-option-text">
              <strong>{t("parts:importAct.label")}</strong>
              <span>{t("parts:importAct.hint")}</span>
            </div>
          </button>
          <button className="source-option part-option part-option--numero" onClick={() => pick(onSelectImportCloud)}>
            <Cloud size={22} />
            <div className="part-option-text">
              <strong>{t("parts:importCloud.label")}</strong>
              <span>{t("parts:importCloud.hint")}</span>
            </div>
          </button>
          <button className="source-option part-option part-option--entracte" onClick={() => pick(onSelectEntracte)}>
            <Coffee size={22} />
            <div className="part-option-text">
              <strong>{t("parts:intermission.label")}</strong>
              <span>{t("parts:intermission.hint")}</span>
            </div>
          </button>
          <button className="source-option part-option part-option--presentation" onClick={() => pick(onSelectPresentation)}>
            <MicVocal size={22} />
            <div className="part-option-text">
              <strong>{t("parts:hostSegment.label")}</strong>
              <span>{t("parts:hostSegment.hint")}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
