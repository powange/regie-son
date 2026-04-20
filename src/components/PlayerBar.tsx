import { Play, Pause, SkipForward, Square, AlertTriangle, PauseCircle } from "lucide-react";
import { PlayerState } from "../usePlayer";
import { Project, PlaylistItem } from "../types";

function getNextItem(state: PlayerState, project: Project): PlaylistItem | null {
  const { position, isPlaying } = state;
  if (!position) return null;
  if (!isPlaying) {
    return project.numeros[position.numeroIndex]?.items[position.audioIndex] ?? null;
  }
  const items = project.numeros[position.numeroIndex]?.items ?? [];
  if (position.audioIndex + 1 < items.length) return items[position.audioIndex + 1];
  for (let ni = position.numeroIndex + 1; ni < project.numeros.length; ni++) {
    if (project.numeros[ni].items.length > 0) return project.numeros[ni].items[0];
  }
  return null;
}

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
  const { position, isPlaying, progress, audioError } = state;

  const nextItem = getNextItem(state, project);
  const nextNote = nextItem?.note ?? null;

  const currentNumero = position !== null ? project.numeros[position.numeroIndex] : null;
  const currentItem = currentNumero ? currentNumero.items[position!.audioIndex] : null;
  const hasAudio = project.numeros.some((n) => n.items.some((i) => i.type === "audio"));
  const onPause = currentItem?.type === "pause";

  const { position: pos, duration: dur } = progress;
  const progressPct = dur > 0 ? Math.min((pos / dur) * 100, 100) : 0;

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!position || dur <= 0 || onPause) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(ratio * dur, dur)));
  }

  return (
    <div className={`player-bar${isPlaying ? " player-bar--playing" : ""}${onPause ? " player-bar--on-pause" : ""}`}>
      <div className="player-top">
        <div className="player-controls">
          <button className="player-btn player-btn--stop" onClick={onStop} disabled={!position} title="Stop">
            <Square size={16} />
          </button>
          <button className="player-btn player-btn--play" onClick={onTogglePlay} disabled={!hasAudio} title={isPlaying ? "Pause" : "Lecture"}>
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button className="player-btn player-btn--next" onClick={onNext} disabled={!hasAudio} title="Piste suivante">
            <SkipForward size={18} />
          </button>
          {nextNote && (
            <span className="player-next-note">{nextNote}</span>
          )}
        </div>

        <div className="player-info">
          {onPause ? (
            <span className="player-pause-indicator">
              <PauseCircle size={14} />
              En attente — appuyez sur Play pour continuer
            </span>
          ) : currentNumero && currentItem?.type === "audio" ? (
            <>
              <span className="player-numero">{currentNumero.name}</span>
              <span className="player-sep">›</span>
              <span className="player-track">{currentItem.original_name}</span>
            </>
          ) : (
            <span className="player-idle">
              {hasAudio ? "Prêt à lire" : "Aucune musique dans ce spectacle"}
            </span>
          )}
        </div>
      </div>

      {audioError ? (
        <div className="player-error">
          <AlertTriangle size={13} />
          {audioError}
        </div>
      ) : (
        <div className="player-progress-row">
          <span className="player-time">{onPause ? "--:--" : formatTime(pos)}</span>
          <div
            className={`player-progress-bar${position && !onPause ? " player-progress-bar--active" : ""}`}
            onClick={handleSeekClick}
          >
            <div className="player-progress-fill" style={{ width: onPause ? "0%" : `${progressPct}%` }} />
            <div className="player-progress-thumb" style={{ left: onPause ? "0%" : `${progressPct}%` }} />
          </div>
          <span className="player-time">{dur > 0 && !onPause ? formatTime(dur) : "--:--"}</span>
        </div>
      )}
    </div>
  );
}
