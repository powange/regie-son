import { useState, useEffect } from "react";
import { X, Volume2, RefreshCw, CheckCircle, Download, ArrowDownCircle } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Settings } from "../useSettings";
import { UpdaterState } from "../useUpdater";

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

  async function loadDevices() {
    setLoading(true);
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all
        .filter((d) => d.kind === "audiooutput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || "Périphérique audio" }));
      setDevices(outputs.length > 0 ? outputs : [{ deviceId: "default", label: "Défaut du système" }]);
    } catch {
      setDevices([{ deviceId: "default", label: "Défaut du système" }]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDevices(); getVersion().then(setVersion); }, []);

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
            <div className="settings-devices">
              {devices.map((d) => (
                <button
                  key={d.deviceId}
                  className={`device-option${d.deviceId === selectedId ? " device-option--selected" : ""}`}
                  onClick={() => onUpdate({ audioOutputDeviceId: d.deviceId === "default" ? null : d.deviceId })}
                >
                  <span className="device-label">{d.label}</span>
                  {d.deviceId === selectedId && <CheckCircle size={15} />}
                </button>
              ))}
            </div>
          )}

          <button className="settings-refresh" onClick={loadDevices}>
            <RefreshCw size={13} />
            Actualiser la liste
          </button>
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

            {!updaterState.checking && !updaterState.update && (
              <span className="settings-update-status">
                <CheckCircle size={13} />
                À jour
              </span>
            )}
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          {version && <span style={{ fontSize: "0.8rem", color: "var(--text2)" }}>v{version}</span>}
          <button className="btn-primary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
