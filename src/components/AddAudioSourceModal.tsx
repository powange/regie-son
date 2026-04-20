import { useState } from "react";
import { Monitor, Link, X, Download } from "lucide-react";

interface Props {
  onSelectLocal: () => void;
  onSelectUrl: (url: string) => Promise<void>;
  onClose: () => void;
}

export default function AddAudioSourceModal({ onSelectLocal, onSelectUrl, onClose }: Props) {
  const [view, setView] = useState<"list" | "url">("list");
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setDownloading(true);
    try {
      await onSelectUrl(trimmed);
      onClose();
    } catch (err) {
      setError(String(err));
      setDownloading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={!downloading ? onClose : undefined}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Ajouter une musique</h2>
          {!downloading && <button className="btn-icon" onClick={onClose}><X size={16} /></button>}
        </div>

        {view === "list" && (
          <div className="source-list">
            <button className="source-option" onClick={() => { onClose(); onSelectLocal(); }}>
              <Monitor size={20} />
              <span>Cet ordinateur</span>
            </button>
            <button className="source-option" onClick={() => setView("url")}>
              <Link size={20} />
              <span>Depuis une URL</span>
            </button>
          </div>
        )}

        {view === "url" && (
          <div>
            <div className="modal-field">
              <label>URL du fichier audio</label>
              <input
                type="url"
                placeholder="https://exemple.com/musique.mp3"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null); }}
                disabled={downloading}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleDownload()}
              />
            </div>

            {error && <p className="modal-error">{error}</p>}

            <div className="modal-actions">
              {!downloading && (
                <button className="btn" onClick={() => { setView("list"); setError(null); }}>
                  Retour
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleDownload}
                disabled={!url.trim() || downloading}
              >
                <Download size={14} />
                {downloading ? "Téléchargement…" : "Télécharger"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
