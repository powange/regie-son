import { useState, useEffect } from "react";
import { Monitor, Link, FileVideo, PauseCircle, Download, XCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { translateError } from "../errorMessage";
import Modal from "./Modal";

type View = "list" | "url" | "youtube";

// Étape émise par Rust pendant un téléchargement yt-dlp : un nom d'étape, pas
// une phrase. Les clés sont écrites en clair pour rester extractibles et typées.
interface YtDlpStep {
  step: "fetchingInfo" | "downloading";
  title?: string;
}

function stepLabel(t: TFunction<["audio", "common"]>, s: YtDlpStep): string {
  switch (s.step) {
    case "fetchingInfo":
      return t("audio:download.fetchingInfo");
    case "downloading":
      return t("audio:download.downloadingTitle", { title: s.title ?? "" });
  }
}

interface DownloadFormProps {
  label: string;
  placeholder: string;
  hint?: string;
  withProgress?: boolean;
  onSubmit: (url: string, downloadId: string) => Promise<void>;
  onBack: () => void;
}

function DownloadForm({ label, placeholder, hint, withProgress, onSubmit, onBack }: DownloadFormProps) {
  const { t } = useTranslation(["audio", "common"]);
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<YtDlpStep | null>(null);
  const [downloadId, setDownloadId] = useState<string | null>(null);

  useEffect(() => {
    if (!downloading || !withProgress) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<YtDlpStep>("yt-dlp-progress", (e) => setStep(e.payload))
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch((err) => console.error("listen yt-dlp-progress:", err));
    return () => { cancelled = true; unlisten?.(); };
  }, [downloading, withProgress]);

  async function handleDownload() {
    const trimmed = url.trim();
    if (!trimmed || downloading) return;
    const id = crypto.randomUUID();
    setDownloadId(id);
    setError(null);
    setStep(null);
    setDownloading(true);
    try {
      await onSubmit(trimmed, id);
    } catch (err) {
      setError(translateError(err));
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
          <span>
            {step
              ? stepLabel(t, step)
              : withProgress
                ? t("audio:download.initializing")
                : t("audio:download.inProgress")}
          </span>
        </div>
      )}

      {error && <p className="modal-error">{error}</p>}

      <div className="modal-actions">
        {!downloading && (
          <button className="btn btn-secondary" onClick={onBack}>{t("common:actions.back")}</button>
        )}
        {downloading ? (
          <button className="btn btn-ghost" onClick={handleCancel}>
            <XCircle size={14} />
            {t("common:actions.cancel")}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={!url.trim()}
          >
            <Download size={14} />
            {t("audio:download.submit")}
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
  onSelectPause: () => void;
  onClose: () => void;
}

export default function AddAudioSourceModal({ onSelectLocal, onSelectUrl, onSelectYoutube, onSelectPause, onClose }: Props) {
  const { t } = useTranslation(["audio", "common"]);
  const [view, setView] = useState<View>("list");

  function back() { setView("list"); }

  return (
    <Modal title={t("audio:addStep")} onClose={onClose} canClose={view === "list"} style={{ maxWidth: 380 }}>

        {view === "list" && (
          <div className="source-list">
            <div className="source-category-title">{t("audio:categoryMusic")}</div>
            <button className="source-option" onClick={() => { onClose(); onSelectLocal(); }}>
              <Monitor size={20} />
              <span>{t("audio:thisComputer")}</span>
            </button>
            <button className="source-option" onClick={() => setView("url")}>
              <Link size={20} />
              <span>{t("audio:fromUrl")}</span>
            </button>
            <button className="source-option" onClick={() => setView("youtube")}>
              <FileVideo size={20} />
              <span>{t("audio:youtube")}</span>
            </button>

            <div className="source-category-title">{t("audio:categoryPause")}</div>
            <button className="source-option" onClick={() => { onClose(); onSelectPause(); }}>
              <PauseCircle size={20} />
              <span>{t("audio:addPause")}</span>
            </button>
          </div>
        )}

        {view === "url" && (
          <DownloadForm
            label={t("audio:download.urlLabel")}
            placeholder={t("audio:download.urlPlaceholder")}
            onSubmit={async (url, id) => { await onSelectUrl(url, id); onClose(); }}
            onBack={back}
          />
        )}

        {view === "youtube" && (
          <DownloadForm
            label={t("audio:download.youtubeLabel")}
            placeholder={t("audio:download.youtubePlaceholder")}
            hint={t("audio:download.youtubeHint")}
            withProgress
            onSubmit={async (url, id) => { await onSelectYoutube(url, id); onClose(); }}
            onBack={back}
          />
        )}
    </Modal>
  );
}
