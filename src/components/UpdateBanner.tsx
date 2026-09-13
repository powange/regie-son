import { Download, X, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UpdaterState } from "../useUpdater";

interface Props {
  state: UpdaterState;
  onInstall: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  const { t } = useTranslation(["updater"]);
  if (!state.update && !state.installing) return null;

  return (
    <div className="update-banner">
      <div className="update-banner-content">
        {state.installing ? (
          <>
            <RefreshCw size={15} className="update-banner-spin" />
            <span>
              {state.progress !== null
                ? t("updater:installingPercent", { percent: state.progress })
                : t("updater:installing")}
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
              {t("updater:available", { version: state.update?.version ?? "" })}
            </span>
            {state.error && <span className="update-banner-error">{state.error}</span>}
            <button className="update-banner-btn" onClick={onInstall}>
              {t("updater:install")}
            </button>
            <button className="btn-icon update-banner-close" onClick={onDismiss} title={t("updater:dismiss")}>
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
