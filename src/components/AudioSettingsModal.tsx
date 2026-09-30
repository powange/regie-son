import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { Region } from "wavesurfer.js/dist/plugins/regions";
import { AudioFile } from "../types";
import { audioMimeType } from "../mime";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";
import { loadSettings } from "../useSettings";
import { TrackTimesError, formatTime, parseTime, validateTrackTimes } from "../trackTimes";


interface Props {
  audio: AudioFile;
  projectPath: string;
  onSave: (updated: AudioFile) => void;
  onClose: () => void;
}

export default function AudioSettingsModal({ audio, projectPath, onSave, onClose }: Props) {
  const { t } = useTranslation(["audio", "common"]);
  const [startRaw, setStartRaw] = useState(formatTime(audio.startTime));
  const [endRaw, setEndRaw] = useState(formatTime(audio.endTime));
  const [fadeInRaw, setFadeInRaw] = useState(audio.fadeIn !== undefined ? String(audio.fadeIn) : "");
  const [fadeOutRaw, setFadeOutRaw] = useState(audio.fadeOut !== undefined ? String(audio.fadeOut) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformReady, setWaveformReady] = useState(false);
  const [fileDuration, setFileDuration] = useState<number | null>(null);

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

        // The preview goes to its own output (headphones), never the PA.
        const media = ws.getMediaElement() as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
        media.setSinkId?.(loadSettings().previewDeviceId ?? "").catch(() => {});

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
          setFileDuration(duration);
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

  // A valid value typed in a field moves the region, so that the waveform
  // always shows what will be saved.
  useEffect(() => {
    const region = regionRef.current;
    if (!waveformReady || !region || fileDuration === null) return;
    const start = startRaw.trim() === "" ? 0 : parseTime(startRaw);
    const end = endRaw.trim() === "" ? fileDuration : parseTime(endRaw);
    if (start === undefined || end === undefined) return;
    const clampedEnd = Math.min(end, fileDuration);
    if (start >= clampedEnd) return;
    if (Math.abs(region.start - start) < 0.05 && Math.abs(region.end - clampedEnd) < 0.05) return;
    region.setOptions({ start, end: clampedEnd });
  }, [startRaw, endRaw, waveformReady, fileDuration]);

  function errorMessage(error: TrackTimesError): string {
    switch (error.code) {
      case "invalidStart": return t("audio:settings.invalidStart");
      case "invalidEnd": return t("audio:settings.invalidEnd");
      case "endBeforeStart": return t("audio:settings.endBeforeStart");
      case "startBeyondFile": return t("audio:settings.startBeyondFile", { duration: formatTime(error.duration) });
      case "endBeyondFile": return t("audio:settings.endBeyondFile", { duration: formatTime(error.duration) });
      case "invalidFadeIn": return t("audio:settings.invalidFadeIn");
      case "invalidFadeOut": return t("audio:settings.invalidFadeOut");
      case "fadesTooLong": return t("audio:settings.fadesTooLong", { length: formatTime(error.length) });
    }
  }

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
    const result = validateTrackTimes(
      { start: startRaw, end: endRaw, fadeIn: fadeInRaw, fadeOut: fadeOutRaw },
      fileDuration,
    );
    if (!result.ok) {
      setError(errorMessage(result.error));
      return;
    }
    onSave({ ...audio, ...result.value });
    onClose();
  }

  return (
    <Modal
      title={t("audio:settings.title", { name: audio.original_name })}
      onClose={onClose}
      closeOnBackdrop={false}
      style={{ width: "calc(100vw - 4rem)", maxWidth: 1200 }}
    >

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
    </Modal>
  );
}
