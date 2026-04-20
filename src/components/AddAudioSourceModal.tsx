import { useState, useEffect } from "react";
import { Monitor, Link, FileVideo, X, Download, XCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { friendlyError } from "../friendlyError";

type View = "list" | "url" | "youtube";

interface DownloadFormProps {
  label: string;
  placeholder: string;
  hint?: string;
  withProgress?: boolean;
  onSubmit: (url: string, downloadId: string) => Promise<void>;
  onBack: () => void;
}

function DownloadForm({ label, placeholder, hint, withProgress, onSubmit, onBack }: DownloadFormProps) {
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [downloadId, setDownloadId] = useState<string | null>(null);

  useEffect(() => {
    if (!downloading || !withProgress) return;
    let unlisten: (() => void) | undefined;
    listen<{ step: string }>("yt-dlp-progress", (e) => setStep(e.payload.step))
      .then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [downloading, withProgress]);

  async function handleDownload() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const id = crypto.randomUUID();
    setDownloadId(id);
    setError(null);
    setStep(null);
    setDownloading(true);
    try {
      await onSubmit(trimmed, id);
    } catch (err) {
      setError(friendlyError(err));
      setDownloading(false);
      setStep(null);
      setDownloadId(null);
    }
  }

  async function handleCancel() {
    if (!downloadId) return;
    try { await invoke("cancel_download", { id: downloadId }); } catch { /* ignore */ }
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
        {hint && !downloading && <span className="modal-hint">{hint}</span>}
      </div>

      {downloading && (
        <div className="download-progress">
          <div className="download-spinner" />
          <span>{step ?? (withProgress ? "Initialisation…" : "Téléchargement en cours…")}</span>
        </div>
      )}

      {error && <p className="modal-error">{error}</p>}

      <div className="modal-actions">
        {!downloading && (
          <button className="btn btn-secondary" onClick={onBack}>Retour</button>
        )}
        {downloading ? (
          <button className="btn btn-ghost" onClick={handleCancel}>
            <XCircle size={14} />
            Annuler
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={!url.trim()}
          >
            <Download size={14} />
            Télécharger
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  onSelectLocal: () => void;
  onSelectUrl: (url: string, downloadId: string) => Promise<void>;
  onSelectYoutube: (url: string, downloadId: string) => Promise<void>;
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
            onSubmit={async (url, id) => { await onSelectUrl(url, id); onClose(); }}
            onBack={back}
          />
        )}

        {view === "youtube" && (
          <DownloadForm
            label="Lien de la vidéo YouTube"
            placeholder="https://www.youtube.com/watch?v=..."
            hint="Télécharge l'audio depuis YouTube (inclus dans l'application)"
            withProgress
            onSubmit={async (url, id) => { await onSelectYoutube(url, id); onClose(); }}
            onBack={back}
          />
        )}
      </div>
    </div>
  );
}
