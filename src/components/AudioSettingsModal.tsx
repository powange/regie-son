import { useEffect, useRef, useState } from "react";
import { X, Play, Pause } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import { AudioFile } from "../types";
import { audioMimeType } from "../mime";
import { useTranslation } from "react-i18next";
import { useModal } from "../useModal";


function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseTime(str: string): number | undefined {
  str = str.trim();
  if (str === "") return undefined;
  if (/^\d+:\d{1,2}$/.test(str)) {
    const [m, s] = str.split(":").map(Number);
    return m * 60 + s;
  }
  const n = Number(str);
  if (!isNaN(n) && n >= 0) return n;
  return undefined;
}

function parseDuration(str: string): number | undefined {
  str = str.trim();
  if (str === "") return undefined;
  const n = Number(str);
  if (!isNaN(n) && n > 0) return n;
  return undefined;
}

interface Props {
  audio: AudioFile;
  projectPath: string;
  onSave: (updated: AudioFile) => void;
  onClose: () => void;
}

export default function AudioSettingsModal({ audio, projectPath, onSave, onClose }: Props) {
  const { t } = useTranslation(["audio", "common"]);
  useModal(onClose);
  const [startRaw, setStartRaw] = useState(formatTime(audio.startTime));
  const [endRaw, setEndRaw] = useState(formatTime(audio.endTime));
  const [fadeInRaw, setFadeInRaw] = useState(audio.fadeIn !== undefined ? String(audio.fadeIn) : "");
  const [fadeOutRaw, setFadeOutRaw] = useState(audio.fadeOut !== undefined ? String(audio.fadeOut) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const regionRef = useRef<Region | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const startRawRef = useRef(startRaw);
  const endRawRef = useRef(endRaw);
  startRawRef.current = startRaw;
  endRawRef.current = endRaw;

  useEffect(() => {
    let cancelled = false;
    const container = waveformRef.current;
    if (!container) return;

    const filePath = projectPath + "/musiques/" + audio.filename;

    invoke<ArrayBuffer>("read_audio_file", { path: filePath })
      .then((buffer) => {
        if (cancelled) return;
        const blob = new Blob([buffer], { type: audioMimeType(audio.filename) });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;

        const regions = RegionsPlugin.create();
        regionsRef.current = regions;
        const ws = WaveSurfer.create({
          container,
          waveColor: "#6b7890",
          progressColor: "#e94560",
          cursorColor: "#ffffff",
          height: 110,
          barWidth: 2,
          barGap: 1,
          barHeight: 1,
          normalize: true,
          url,
          plugins: [regions],
        });
        wavesurferRef.current = ws;

        ws.on("ready", () => {
          if (cancelled) return;
          const duration = ws.getDuration();
          const start = parseTime(startRawRef.current) ?? 0;
          const end = parseTime(endRawRef.current) ?? duration;
          const region = regions.addRegion({
            start: Math.max(0, Math.min(start, duration)),
            end: Math.max(0, Math.min(end, duration)),
            color: "rgba(233, 69, 96, 0.2)",
            drag: true,
            resize: true,
          });
          regionRef.current = region;
          region.on("update-end", () => {
            setStartRaw(formatTime(region.start));
            setEndRaw(formatTime(region.end));
            setError(null);
          });
          setWaveformReady(true);
        });
        ws.on("play", () => setIsPlaying(true));
        ws.on("pause", () => setIsPlaying(false));
        ws.on("finish", () => setIsPlaying(false));
      })
      .catch(() => {
        if (!cancelled) setError(t("audio:settings.waveformError"));
      });

    return () => {
      cancelled = true;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePreview() {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (ws.isPlaying()) ws.pause();
    else {
      const r = regionRef.current;
      if (r && (ws.getCurrentTime() < r.start || ws.getCurrentTime() >= r.end)) {
        ws.setTime(r.start);
      }
      ws.play();
    }
  }

  function handleSave() {
    const startTime = parseTime(startRaw);
    const endTime = parseTime(endRaw);
    const fadeIn = parseDuration(fadeInRaw);
    const fadeOut = parseDuration(fadeOutRaw);

    if (startRaw.trim() !== "" && startTime === undefined) {
      setError(t("audio:settings.invalidStart"));
      return;
    }
    if (endRaw.trim() !== "" && endTime === undefined) {
      setError(t("audio:settings.invalidEnd"));
      return;
    }
    if (startTime !== undefined && endTime !== undefined && endTime <= startTime) {
      setError(t("audio:settings.endBeforeStart"));
      return;
    }
    if (fadeInRaw.trim() !== "" && fadeIn === undefined) {
      setError(t("audio:settings.invalidFadeIn"));
      return;
    }
    if (fadeOutRaw.trim() !== "" && fadeOut === undefined) {
      setError(t("audio:settings.invalidFadeOut"));
      return;
    }

    onSave({ ...audio, startTime, endTime, fadeIn, fadeOut });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: "calc(100vw - 4rem)", maxWidth: 1200 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>{t("audio:settings.title", { name: audio.original_name })}</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="waveform-wrapper">
          <button
            type="button"
            className="waveform-play-btn"
            onClick={togglePreview}
            disabled={!waveformReady}
            title={isPlaying ? t("audio:player.pause") : t("audio:settings.playPreview")}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <div className="waveform-container" ref={waveformRef} />
        </div>

        <div className="audio-settings-grid">
          <div className="modal-field">
            <label>{t("audio:settings.startLabel")}</label>
            <input
              type="text"
              placeholder={t("audio:settings.startPlaceholder")}
              value={startRaw}
              onChange={(e) => { setStartRaw(e.target.value); setError(null); }}
            />
          </div>

          <div className="modal-field">
            <label>{t("audio:settings.endLabel")}</label>
            <input
              type="text"
              placeholder={t("audio:settings.endPlaceholder")}
              value={endRaw}
              onChange={(e) => { setEndRaw(e.target.value); setError(null); }}
            />
          </div>

          <div className="modal-field">
            <label>{t("audio:settings.fadeInLabel")}</label>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder={t("audio:settings.secondsPlaceholder")}
              value={fadeInRaw}
              onChange={(e) => { setFadeInRaw(e.target.value); setError(null); }}
            />
          </div>

          <div className="modal-field">
            <label>{t("audio:settings.fadeOutLabel")}</label>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder={t("audio:settings.secondsPlaceholder")}
              value={fadeOutRaw}
              onChange={(e) => { setFadeOutRaw(e.target.value); setError(null); }}
            />
          </div>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={handleSave}>{t("common:actions.save")}</button>
          <button className="btn btn-secondary" onClick={onClose}>{t("common:actions.cancel")}</button>
        </div>
      </div>
    </div>
  );
}
