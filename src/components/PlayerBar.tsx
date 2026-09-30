import { Play, Pause, SkipForward, Square, AlertTriangle, PauseCircle } from "lucide-react";
import { PlayerState } from "../usePlayer";
import { Project } from "../types";
import { Trans, useTranslation } from "react-i18next";
import { getNextContext } from "../playerNav";

interface Props {
  state: PlayerState;
  project: Project;
  onTogglePlay: () => void;
  onNext: () => void;
  onStop: () => void;
  onSeek: (position: number) => void;
}

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function PlayerBar({ state, project, onTogglePlay, onNext, onStop, onSeek }: Props) {
  const { t } = useTranslation(["audio"]);
  const { position, isPlaying, progress, audioError, outputError } = state;

  const nextContext = getNextContext(state, project);
  const nextCue = nextContext?.item.cue ?? null;
  const nextNumeroName = nextContext?.numero.name ?? null;

  const currentNumero = position !== null ? project.numeros[position.numeroIndex] : null;
  const currentItem = currentNumero ? currentNumero.items[position!.audioIndex] : null;
  const hasAudio = project.numeros.some((n) => n.items.some((i) => i.type === "audio"));
  const onPause = currentItem?.type === "pause";
  const pauseDuration = currentItem?.type === "pause" ? (currentItem.duration ?? 0) : 0;
  const isTimedPause = onPause && pauseDuration > 0;

  const { position: pos, duration: dur } = progress;
  const progressPct = dur > 0 ? Math.min((pos / dur) * 100, 100) : 0;
  const pauseRemaining = isTimedPause ? Math.max(0, pauseDuration - pos) : 0;

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!position || dur <= 0 || onPause) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(ratio * dur, dur)));
  }

  return (
    <div className={`player-bar${isPlaying ? " player-bar--playing" : ""}${onPause ? " player-bar--on-pause" : ""}`}>

      {(currentNumero || onPause) && (
        <div className="player-section">
          {onPause ? (
            <span className="player-pause-indicator">
              <PauseCircle size={13} />
              {isTimedPause
                ? (
                  <Trans
                    ns="audio"
                    i18nKey="player.pauseRemaining"
                    values={{ seconds: pauseRemaining.toFixed(1) }}
                    components={{ strong: <strong /> }}
                  />
                )
                : t("audio:player.waiting")}
            </span>
          ) : (
            <span className="player-current-numero">{currentNumero!.name}</span>
          )}
        </div>
      )}

      <div className="player-top">
        <div className="player-controls">
          <button className="player-btn player-btn--stop" onClick={onStop} disabled={!position} title={t("audio:player.stop")}>
            <Square size={16} />
          </button>
          <button className="player-btn player-btn--play" onClick={onTogglePlay} disabled={!hasAudio} title={isPlaying ? t("audio:player.pause") : t("audio:player.play")}>
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
        </div>

        <div className="player-next-card">
          <button className="player-btn player-btn--next" onClick={onNext} disabled={!hasAudio} title={t("audio:player.next")}>
            <SkipForward size={18} />
          </button>
          {nextContext && (
            <div className="player-next-info">
              {nextCue && <span className="player-next-cue" title={t("audio:item.cue")}>{nextCue}</span>}
              {nextNumeroName && <span className="player-next-numero">{nextNumeroName}</span>}
            </div>
          )}
        </div>

        {state.fade && (
          <div className={`player-fade-card player-fade-card--${state.fade.type}`}>
            <span className="player-fade-label">
              {state.fade.type === "in" ? t("audio:player.fadeIn") : t("audio:player.fadeOut")}
            </span>
            <span className="player-fade-countdown">
              {state.fade.remaining.toFixed(1)}s
            </span>
          </div>
        )}
      </div>

      {audioError ? (
        <div className="player-error">
          <AlertTriangle size={13} />
          {audioError}
        </div>
      ) : (
        <div className="player-progress-row">
          <span className="player-time">
            {onPause ? (isTimedPause ? formatTime(pos) : "--:--") : formatTime(pos)}
          </span>
          <div
            className={`player-progress-bar${position && !onPause ? " player-progress-bar--active" : ""}`}
            onClick={handleSeekClick}
          >
            <div
              className="player-progress-fill"
              style={{ width: onPause && !isTimedPause ? "0%" : `${progressPct}%` }}
            />
            <div
              className="player-progress-thumb"
              style={{ left: onPause && !isTimedPause ? "0%" : `${progressPct}%` }}
            />
          </div>
          {/* Time left in the excerpt, what the operator watches for the cue;
              the full length stays in the tooltip. */}
          <span className="player-time" title={dur > 0 ? formatTime(dur) : undefined}>
            {onPause ? (isTimedPause ? formatTime(dur) : "--:--") : dur > 0 ? `−${formatTime(dur - pos)}` : "--:--"}
          </span>
        </div>
      )}

      {outputError && (
        <div className="player-error">
          <AlertTriangle size={13} />
          {outputError}
        </div>
      )}
    </div>
  );
}
