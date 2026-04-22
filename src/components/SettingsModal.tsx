import { useEffect, useRef, useState } from "react";
import { X, Volume2, RefreshCw, CheckCircle, Download, ArrowDownCircle, Keyboard, RotateCcw, FileVideo } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "../useSettings";
import { UpdaterState } from "../useUpdater";
import {
  KEY_ACTIONS,
  KeyAction,
  KeyBinding,
  DEFAULT_BINDINGS,
  bindingFromEvent,
  bindingsEqual,
  formatBinding,
  isForbiddenKey,
  isModifierKey,
  mergeWithDefaults,
} from "../keyBindings";

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface Props {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onClose: () => void;
  updaterState: UpdaterState;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}

export default function SettingsModal({ settings, onUpdate, onClose, updaterState, onCheckUpdate, onInstallUpdate }: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState("");
  const [listeningAction, setListeningAction] = useState<KeyAction | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null);
  const [ytDlpUpdating, setYtDlpUpdating] = useState(false);
  const [ytDlpError, setYtDlpError] = useState<string | null>(null);

  const mergedBindings = mergeWithDefaults(settings.keyBindings);

  async function loadDevices() {
    setLoading(true);
    const fallback = [{ deviceId: "default", label: "Défaut du système" }];
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setDevices(fallback);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch { /* some platforms (WebKit2GTK) don't support it — continue anyway */ }
      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Périphérique audio" }));
      setDevices(outputs.length > 0 ? outputs : fallback);
    } catch {
      setDevices(fallback);
    } finally {
      setLoading(false);
    }
  }

  async function loadYtDlpVersion() {
    try {
      const v = await invoke<string>("get_yt_dlp_version");
      setYtDlpVersion(v);
      setYtDlpError(null);
    } catch (err) {
      setYtDlpVersion(null);
      setYtDlpError(String(err));
    }
  }

  async function updateYtDlp() {
    setYtDlpUpdating(true);
    setYtDlpError(null);
    try {
      const v = await invoke<string>("update_yt_dlp");
      setYtDlpVersion(v);
    } catch (err) {
      setYtDlpError(String(err));
    } finally {
      setYtDlpUpdating(false);
    }
  }

  useEffect(() => {
    loadDevices();
    loadYtDlpVersion();
    if (import.meta.env.DEV) {
      setVersion(__DEV_VERSION__);
    } else {
      getVersion().then(setVersion);
    }
  }, []);

  function updateBinding(action: KeyAction, binding: KeyBinding) {
    // Swap: if another action has the same binding, unset it
    const newOverrides: Partial<Record<KeyAction, KeyBinding>> = { ...(settings.keyBindings ?? {}) };
    if (binding.key) {
      for (const def of KEY_ACTIONS) {
        if (def.id === action) continue;
        const other = mergedBindings[def.id];
        if (other.key && bindingsEqual(other, binding)) {
          newOverrides[def.id] = { key: "" };
        }
      }
    }
    newOverrides[action] = binding;
    onUpdate({ keyBindings: newOverrides });
  }

  const listeningRef = useRef(listeningAction);
  listeningRef.current = listeningAction;

  useEffect(() => {
    if (!listeningAction) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!listeningRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (isModifierKey(e.key)) return; // wait for a non-modifier key
      if (isForbiddenKey(e.key)) {
        setCaptureError(`La touche « ${e.key} » ne peut pas être utilisée.`);
        return;
      }
      const binding = bindingFromEvent(e);
      updateBinding(listeningRef.current, binding);
      setListeningAction(null);
      setCaptureError(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeningAction]);

  function startListen(action: KeyAction) {
    setCaptureError(null);
    setListeningAction(action);
  }

  function cancelListen() {
    setListeningAction(null);
    setCaptureError(null);
  }

  function resetBinding(action: KeyAction) {
    const overrides = { ...(settings.keyBindings ?? {}) };
    delete overrides[action];
    onUpdate({ keyBindings: overrides });
  }

  function disableBinding(action: KeyAction) {
    updateBinding(action, { key: "" });
  }

  const selectedId = settings.audioOutputDeviceId ?? "default";

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title-row">
          <h2>Paramètres</h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <Volume2 size={15} />
            Sortie audio
          </div>

          {loading ? (
            <p className="settings-loading">Chargement des périphériques…</p>
          ) : (
            <select
              className="settings-select"
              value={selectedId}
              onChange={(e) => onUpdate({ audioOutputDeviceId: e.target.value === "default" ? null : e.target.value })}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          )}

          <button className="settings-refresh" onClick={loadDevices}>
            <RefreshCw size={13} />
            Actualiser la liste
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <Keyboard size={15} />
            Commandes
          </div>

          <div className="key-binding-list">
            {KEY_ACTIONS.map((def) => {
              const current = mergedBindings[def.id];
              const isDefault = bindingsEqual(current, DEFAULT_BINDINGS[def.id]);
              const isListening = listeningAction === def.id;
              return (
                <div key={def.id} className="key-binding-row">
                  <span className="key-binding-label">{def.label}</span>
                  <button
                    type="button"
                    className={`key-binding-capture${isListening ? " key-binding-capture--listening" : ""}`}
                    onClick={isListening ? cancelListen : () => startListen(def.id)}
                  >
                    {isListening ? "Appuyez sur une touche…" : formatBinding(current)}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => resetBinding(def.id)}
                    disabled={isDefault}
                    title="Réinitialiser au défaut"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => disableBinding(def.id)}
                    disabled={current.key === ""}
                    title="Désactiver le raccourci"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {captureError && <p className="modal-error">{captureError}</p>}
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <Download size={15} />
            Mises à jour
          </div>

          <div className="settings-update-row">
            <button
              className="settings-refresh"
              onClick={onCheckUpdate}
              disabled={updaterState.checking || updaterState.installing}
            >
              <RefreshCw size={13} className={updaterState.checking ? "spin" : ""} />
              {updaterState.checking ? "Vérification…" : "Chercher les mises à jour"}
            </button>

            {!updaterState.checking && updaterState.update && (
              <button className="btn btn-primary settings-install-btn" onClick={onInstallUpdate} disabled={updaterState.installing}>
                <ArrowDownCircle size={14} />
                {updaterState.installing
                  ? updaterState.progress !== null ? `${updaterState.progress}%` : "Installation…"
                  : `Installer v${updaterState.update.version}`}
              </button>
            )}

            {!updaterState.checking && !updaterState.update && !updaterState.error && (
              <span className="settings-update-status">
                <CheckCircle size={13} />
                À jour
              </span>
            )}

            {!updaterState.checking && updaterState.error && (
              <span className="settings-update-status settings-update-error" title={updaterState.error}>
                Erreur de vérification
              </span>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <FileVideo size={15} />
            yt-dlp (téléchargement YouTube)
          </div>

          <div className="settings-update-row">
            <span className="settings-update-status">
              {ytDlpVersion ? `Version ${ytDlpVersion}` : "Version inconnue"}
            </span>
            <button
              className="settings-refresh"
              onClick={updateYtDlp}
              disabled={ytDlpUpdating}
            >
              <RefreshCw size={13} className={ytDlpUpdating ? "spin" : ""} />
              {ytDlpUpdating ? "Mise à jour…" : "Mettre à jour"}
            </button>
          </div>
          {ytDlpError && (
            <span className="settings-update-status settings-update-error" title={ytDlpError}>
              {ytDlpError}
            </span>
          )}

          <label className="settings-toggle-row">
            <input
              type="checkbox"
              checked={settings.autoUpdateYtDlp !== false}
              onChange={(e) => onUpdate({ autoUpdateYtDlp: e.target.checked })}
            />
            <span>Mettre à jour automatiquement au démarrage</span>
          </label>
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          {version && <span style={{ fontSize: "0.8rem", color: "var(--text2)" }}>v{version}</span>}
          <button className="btn-primary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
