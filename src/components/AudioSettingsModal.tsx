import { useState } from "react";
import { X } from "lucide-react";
import { AudioFile } from "../types";

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

interface Props {
  audio: AudioFile;
  onSave: (updated: AudioFile) => void;
  onClose: () => void;
}

export default function AudioSettingsModal({ audio, onSave, onClose }: Props) {
  const [startRaw, setStartRaw] = useState(formatTime(audio.startTime));
  const [endRaw, setEndRaw] = useState(formatTime(audio.endTime));
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const startTime = parseTime(startRaw);
    const endTime = parseTime(endRaw);

    if (startRaw.trim() !== "" && startTime === undefined) {
      setError("Heure de début invalide (format : mm:ss ou secondes)");
      return;
    }
    if (endRaw.trim() !== "" && endTime === undefined) {
      setError("Heure de fin invalide (format : mm:ss ou secondes)");
      return;
    }
    if (startTime !== undefined && endTime !== undefined && endTime <= startTime) {
      setError("L'heure de fin doit être supérieure à l'heure de début");
      return;
    }

    onSave({ ...audio, startTime, endTime });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h2>Paramètres — {audio.original_name}</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-field">
          <label>Début (optionnel)</label>
          <input
            type="text"
            placeholder="ex : 0:30 ou 30"
            value={startRaw}
            onChange={(e) => { setStartRaw(e.target.value); setError(null); }}
          />
        </div>

        <div className="modal-field" style={{ marginTop: "1rem" }}>
          <label>Fin (optionnel)</label>
          <input
            type="text"
            placeholder="ex : 2:45 ou 165"
            value={endRaw}
            onChange={(e) => { setEndRaw(e.target.value); setError(null); }}
          />
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions" style={{ marginTop: "1.4rem" }}>
          <button className="btn btn-primary" onClick={handleSave}>Enregistrer</button>
          <button className="btn" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
