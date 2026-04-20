import { useState } from "react";
import { Monitor, Link, FileVideo, X, Download } from "lucide-react";

type View = "list" | "url" | "youtube";

interface DownloadFormProps {
  label: string;
  placeholder: string;
  hint?: string;
  onSubmit: (url: string) => Promise<void>;
  onBack: () => void;
}

function DownloadForm({ label, placeholder, hint, onSubmit, onBack }: DownloadFormProps) {
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setDownloading(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(String(err));
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="modal-field">
        <label>{label}</label>
        <input
          type="url"
          placeholder={placeholder}
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); }}
          disabled={downloading}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleDownload()}
        />
        {hint && <span style={{ fontSize: "0.78rem", color: "var(--text2)" }}>{hint}</span>}
      </div>

      {error && <p className="modal-error">{error}</p>}

      <div className="modal-actions">
        {!downloading && (
          <button className="btn" onClick={onBack}>Retour</button>
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
  );
}

interface Props {
  onSelectLocal: () => void;
  onSelectUrl: (url: string) => Promise<void>;
  onSelectYoutube: (url: string) => Promise<void>;
  onClose: () => void;
}

export default function AddAudioSourceModal({ onSelectLocal, onSelectUrl, onSelectYoutube, onClose }: Props) {
  const [view, setView] = useState<View>("list");

  function back() { setView("list"); }

  return (
    <div className="modal-overlay" onClick={view === "list" ? onClose : undefined}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Ajouter une musique</h2>
          {view === "list" && <button className="btn-icon" onClick={onClose}><X size={16} /></button>}
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
            <button className="source-option" onClick={() => setView("youtube")}>
              <FileVideo size={20} />
              <span>YouTube</span>
            </button>
          </div>
        )}

        {view === "url" && (
          <DownloadForm
            label="URL du fichier audio"
            placeholder="https://exemple.com/musique.mp3"
            onSubmit={async (url) => { await onSelectUrl(url); onClose(); }}
            onBack={back}
          />
        )}

        {view === "youtube" && (
          <DownloadForm
            label="Lien de la vidéo YouTube"
            placeholder="https://www.youtube.com/watch?v=..."
            hint="Requiert yt-dlp et ffmpeg installés sur cet ordinateur"
            onSubmit={async (url) => { await onSelectYoutube(url); onClose(); }}
            onBack={back}
          />
        )}
      </div>
    </div>
  );
}
