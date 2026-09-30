import { AlertTriangle, Pause, Play, SkipForward, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PlayerState } from "../usePlayer";
import { PlaylistItem, Project } from "../types";
import { formatCountdown, showViewModel } from "../showView";

interface Props {
  state: PlayerState;
  project: Project;
  onTogglePlay: () => void;
  onNext: () => void;
  onStop: () => void;
  onClose: () => void;
}

// Full-screen view for the live show: what plays, what comes next and the
// transport, readable from a distance, with no editing at all. It is not a
// modal: the editor's shortcuts keep working, Escape included, which stops the
// music as everywhere else. Only its own button closes it.
export default function ShowView({ state, project, onTogglePlay, onNext, onStop, onClose }: Props) {
  const { t } = useTranslation(["editor", "audio"]);
  const { current, next, remaining, elapsedRatio, onUntimedPause, hasAudio } = showViewModel(state, project);
  const { position, isPlaying, fade, audioError, outputError } = state;

  function itemName(item: PlaylistItem): string {
    return item.type === "audio" ? item.original_name : t("audio:pause.label");
  }

  const onPause = current?.item.type === "pause";
  const clock = remaining !== null
    ? (onPause ? formatCountdown(remaining) : `−${formatCountdown(remaining)}`)
    : null;

  return (
    <div className={`show-view${isPlaying ? " show-view--playing" : ""}`} role="region" aria-label={t("editor:showView.title")}>
      <div className="show-view-top">
        <span className="show-view-title">{t("editor:showView.title")}</span>
        <button type="button" className="show-view-close" onClick={onClose}>
          <X size={18} />
          {t("editor:showView.close")}
        </button>
      </div>

      <section className="show-view-now">
        <div className="show-view-label">{t("editor:showView.now")}</div>
        {current ? (
          <>
            <div className="show-view-act">{current.numero.name}</div>
            <div className="show-view-item">{itemName(current.item)}</div>
            {current.item.cue && <div className="show-view-cue">{current.item.cue}</div>}
          </>
        ) : (
          <div className="show-view-item show-view-muted">{t("editor:showView.idle")}</div>
        )}

        <div className="show-view-clock-row">
          <div className={`show-view-clock${onUntimedPause ? " show-view-clock--waiting" : ""}`}>
            {clock ?? (onUntimedPause ? t("audio:player.waiting") : "--:--")}
          </div>
          {fade && (
            <div className={`show-view-fade show-view-fade--${fade.type}`}>
              {fade.type === "in" ? t("audio:player.fadeIn") : t("audio:player.fadeOut")}
              <strong>{fade.remaining.toFixed(1)}s</strong>
            </div>
          )}
        </div>
        <div className="show-view-progress" aria-hidden="true">
          <div className="show-view-progress-fill" style={{ width: `${elapsedRatio * 100}%` }} />
        </div>

        {(audioError || outputError) && (
          <div className="show-view-error" role="alert">
            <AlertTriangle size={20} />
            <span>{audioError ?? outputError}</span>
          </div>
        )}
      </section>

      <section className="show-view-next">
        <div className="show-view-label">{t("editor:showView.upNext")}</div>
        {next ? (
          <>
            <div className="show-view-next-cue">{next.item.cue || itemName(next.item)}</div>
            <div className="show-view-next-meta">
              <span>{next.numero.name}</span>
              {next.item.cue && <span>{itemName(next.item)}</span>}
            </div>
          </>
        ) : (
          <div className="show-view-muted">{t("editor:showView.endOfShow")}</div>
        )}
      </section>

      <div className="show-view-controls">
        <button
          type="button"
          className="show-view-btn show-view-btn--stop"
          onClick={onStop}
          disabled={!position}
          title={t("audio:player.stop")}
          aria-label={t("audio:player.stop")}
        >
          <Square size={40} />
        </button>
        <button
          type="button"
          className="show-view-btn show-view-btn--play"
          onClick={onTogglePlay}
          disabled={!hasAudio}
          title={isPlaying ? t("audio:player.pause") : t("audio:player.play")}
          aria-label={isPlaying ? t("audio:player.pause") : t("audio:player.play")}
        >
          {isPlaying ? <Pause size={56} /> : <Play size={56} />}
        </button>
        <button
          type="button"
          className="show-view-btn show-view-btn--next"
          onClick={onNext}
          disabled={!hasAudio}
          title={t("audio:player.next")}
          aria-label={t("audio:player.next")}
        >
          <SkipForward size={44} />
        </button>
      </div>
    </div>
  );
}
