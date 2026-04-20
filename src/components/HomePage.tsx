import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Plus, Music2, Clock, X, AlertCircle, Settings } from "lucide-react";
import { Project } from "../types";
import { RecentProject } from "../useRecentProjects";

interface Props {
  recents: RecentProject[];
  onProjectOpen: (project: Project) => void;
  onRemoveRecent: (path: string) => void;
  onOpenSettings: () => void;
}

export default function HomePage({ recents, onProjectOpen, onRemoveRecent, onOpenSettings }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpenProject() {
    setOpenError(null);
    try {
      const folderPath = await invoke<string | null>("pick_folder");
      if (!folderPath) return;
      const project = await invoke<Project>("open_project", { projectPath: folderPath });
      onProjectOpen(project);
    } catch (err) {
      setOpenError("Impossible d'ouvrir ce projet : " + err);
    }
  }

  async function handleOpenRecent(recent: RecentProject) {
    setOpenError(null);
    try {
      const project = await invoke<Project>("open_project", { projectPath: recent.path });
      onProjectOpen(project);
    } catch {
      setOpenError(`Projet introuvable : "${recent.name}". Il a peut-être été déplacé ou supprimé.`);
      onRemoveRecent(recent.path);
    }
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="home-page">
      <button className="home-settings-btn" onClick={onOpenSettings} title="Paramètres">
        <Settings size={20} />
      </button>
      <div className="home-logo">
        <Music2 size={56} color="#e94560" strokeWidth={1.5} />
        <h1>Régie Son</h1>
        <p>Gestion audio pour spectacles cabaret</p>
      </div>

      <div className="home-actions">
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={18} />
          Nouveau spectacle
        </button>
        <button className="btn-secondary" onClick={handleOpenProject}>
          <FolderOpen size={18} />
          Ouvrir un spectacle
        </button>
      </div>

      {openError && (
        <div className="home-error">
          <AlertCircle size={16} />
          {openError}
        </div>
      )}

      {recents.length > 0 && (
        <div className="recents">
          <div className="recents-header">
            <Clock size={14} />
            Récents
          </div>
          <div className="recents-list">
            {recents.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => handleOpenRecent(r)}>
                <div className="recent-item-info">
                  <span className="recent-item-name">{r.name}</span>
                  <span className="recent-item-path">{r.path}</span>
                </div>
                <span className="recent-item-date">{formatDate(r.lastOpened)}</span>
                <button
                  className="recent-item-remove"
                  title="Retirer de la liste"
                  onClick={(e) => { e.stopPropagation(); onRemoveRecent(r.path); }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={onProjectOpen}
        />
      )}
    </div>
  );
}

interface CreateModalProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

function slugify(name: string) {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function CreateProjectModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [baseDir, setBaseDir] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<string>("get_default_projects_dir").then((dir) => {
      setBaseDir(dir);
      setFolderPath(dir);
    });
  }, []);

  function handleNameChange(value: string) {
    setName(value);
    const slug = slugify(value);
    const sep = baseDir.includes("\\") ? "\\" : "/";
    setFolderPath(slug ? baseDir + sep + slug : baseDir);
  }

  async function pickFolder() {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (path) {
        setBaseDir(path);
        const slug = slugify(name);
        const sep = path.includes("\\") ? "\\" : "/";
        setFolderPath(slug ? path + sep + slug : path);
      }
    } catch (err) {
      setError("Impossible d'ouvrir le sélecteur : " + err);
    }
  }

  async function handleCreate() {
    if (!name.trim()) { setError("Veuillez saisir un nom de spectacle."); return; }
    if (!folderPath) { setError("Veuillez choisir un dossier."); return; }
    setLoading(true);
    setError("");
    try {
      const project = await invoke<Project>("create_project", {
        name: name.trim(),
        folderPath,
      });
      onCreated(project);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Nouveau spectacle</h2>

        <div className="modal-field">
          <label>Nom du spectacle</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Ex : Cabaret de printemps 2025"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>

        <div className="modal-field">
          <label>Dossier du projet</label>
          <div className="folder-pick">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="Chemin du dossier..."
            />
            <button className="btn-secondary" onClick={pickFolder}>Parcourir</button>
          </div>
          <span style={{ fontSize: "0.78rem", color: "var(--text2)" }}>
            Le dossier sera créé s'il n'existe pas.
          </span>
        </div>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? "Création..." : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}
