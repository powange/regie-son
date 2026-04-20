import { Download, X, RefreshCw } from "lucide-react";
import { UpdaterState } from "../useUpdater";

interface Props {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  if (!state.update && !state.installing) return null;

  return (
    <div className="update-banner">
      <div className="update-banner-content">
        {state.installing ? (
          <>
            <RefreshCw size={15} className="update-banner-spin" />
            <span>
              Installation{state.progress !== null ? ` ${state.progress}%` : "…"}
            </span>
            {state.progress !== null && (
              <div className="update-banner-progress">
                <div className="update-banner-progress-fill" style={{ width: `${state.progress}%` }} />
              </div>
            )}
          </>
        ) : (
          <>
            <Download size={15} />
            <span>
              Mise à jour disponible — version {state.update?.version}
            </span>
            {state.error && <span className="update-banner-error">{state.error}</span>}
            <button className="update-banner-btn" onClick={onInstall}>
              Installer
            </button>
            <button className="btn-icon update-banner-close" onClick={onDismiss} title="Ignorer">
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
