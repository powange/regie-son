import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { translateError } from "../errorMessage";
import { FolderOpen, Plus, Music2, Clock, X, AlertCircle, Settings } from "lucide-react";
import { Project } from "../types";
import { RecentProject } from "../useRecentProjects";
import { RecentNumero } from "../useRecentNumeros";
import OpenProjectModal, { OpenKind } from "./OpenProjectModal";
import CloudImportDialog from "./CloudImportDialog";
import Modal from "./Modal";
import { folderNameFor, joinPath } from "../slug";

interface Props {
  recents: RecentProject[];
  numeroRecents: RecentNumero[];
  onProjectOpen: (project: Project) => void;
  onNumeroOpen: (project: Project) => void;
  onRemoveRecent: (path: string) => void;
  onRemoveNumeroRecent: (path: string) => void;
  onOpenSettings: () => void;
}

export default function HomePage({
  recents, numeroRecents,
  onProjectOpen, onNumeroOpen,
  onRemoveRecent, onRemoveNumeroRecent,
  onOpenSettings,
}: Props) {
  const { t, i18n } = useTranslation(["home", "common"]);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateNumero, setShowCreateNumero] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState<OpenKind | null>(null);
  const [showCloudImport, setShowCloudImport] = useState<OpenKind | null>(null);

  async function handleOpenProject() {
    setOpenError(null);
    try {
      const folderPath = await invoke<string | null>("pick_folder");
      if (!folderPath) return;
      const project = await invoke<Project>("open_project", { projectPath: folderPath });
      onProjectOpen(project);
    } catch (err) {
      setOpenError(t("home:errors.openProject", { detail: translateError(err) }));
    }
  }

  async function handleImportProject() {
    setOpenError(null);
    try {
      const srcFile = await invoke<string | null>("pick_regieson_file");
      if (!srcFile) return;
      const destFolder = await invoke<string | null>("pick_folder");
      if (!destFolder) return;
      const project = await invoke<Project>("import_project", { srcFile, destFolder });
      onProjectOpen(project);
    } catch (err) {
      setOpenError(t("home:errors.import", { detail: translateError(err) }));
    }
  }

  async function handleOpenRecent(recent: RecentProject) {
    setOpenError(null);
    try {
      const project = await invoke<Project>("open_project", { projectPath: recent.path });
      onProjectOpen(project);
    } catch {
      setOpenError(t("home:errors.projectNotFound", { name: recent.name }));
      onRemoveRecent(recent.path);
    }
  }

  async function handleOpenNumero() {
    setOpenError(null);
    try {
      const folderPath = await invoke<string | null>("pick_folder");
      if (!folderPath) return;
      const project = await invoke<Project>("open_numero", { numeroPath: folderPath });
      onNumeroOpen(project);
    } catch (err) {
      setOpenError(t("home:errors.openAct", { detail: translateError(err) }));
    }
  }

  async function handleImportNumero() {
    setOpenError(null);
    try {
      const srcFile = await invoke<string | null>("pick_regiesonnumero_file");
      if (!srcFile) return;
      const destFolder = await invoke<string | null>("pick_folder");
      if (!destFolder) return;
      const project = await invoke<Project>("import_numero_standalone", { srcFile, destFolder });
      onNumeroOpen(project);
    } catch (err) {
      setOpenError(t("home:errors.import", { detail: translateError(err) }));
    }
  }

  async function handleOpenRecentNumero(recent: RecentNumero) {
    setOpenError(null);
    try {
      const project = await invoke<Project>("open_numero", { numeroPath: recent.path });
      onNumeroOpen(project);
    } catch {
      setOpenError(t("home:errors.actNotFound", { name: recent.name }));
      onRemoveNumeroRecent(recent.path);
    }
  }

  async function handleCloudImportSubmit(kind: OpenKind, code: string) {
    const dirCmd = kind === "project" ? "get_default_projects_dir" : "get_default_numeros_dir";
    const importCmd = kind === "project" ? "import_project_from_cloud" : "import_numero_from_cloud";
    const defaultDir = await invoke<string>(dirCmd);
    const sep = defaultDir.includes("\\") ? "\\" : "/";
    const destFolder = `${defaultDir}${sep}cloud-${code}`;
    const project = await invoke<Project>(importCmd, { code, destFolder });
    setShowCloudImport(null);
    if (kind === "project") onProjectOpen(project); else onNumeroOpen(project);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="home-page">
      <button className="home-settings-btn" onClick={onOpenSettings} title={t("common:settings")}>
        <Settings size={20} />
      </button>
      <div className="home-logo">
        <Music2 size={56} color="#e94560" strokeWidth={1.5} />
        {/* i18next-instrument-ignore-next-line — marque, jamais traduite */}
        <h1>Régie Son</h1>
        <p>{t("home:tagline")}</p>
      </div>

      <div className="home-actions-group">
        <h3 className="home-actions-title">{t("home:show.sectionTitle")}</h3>
        <div className="home-actions">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={18} />
            {t("home:show.create")}
          </button>
          <button className="btn-secondary" onClick={() => setShowOpen("project")}>
            <FolderOpen size={18} />
            {t("home:show.open")}
          </button>
        </div>
      </div>

      <div className="home-actions-group">
        <h3 className="home-actions-title">{t("home:act.sectionTitle")}</h3>
        <div className="home-actions">
          <button className="btn-primary" onClick={() => setShowCreateNumero(true)}>
            <Plus size={18} />
            {t("home:act.create")}
          </button>
          <button className="btn-secondary" onClick={() => setShowOpen("numero")}>
            <FolderOpen size={18} />
            {t("home:act.open")}
          </button>
        </div>
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
            {t("home:show.recents")}
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
                  title={t("home:removeFromList")}
                  onClick={(e) => { e.stopPropagation(); onRemoveRecent(r.path); }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {numeroRecents.length > 0 && (
        <div className="recents">
          <div className="recents-header">
            <Clock size={14} />
            {t("home:act.recents")}
          </div>
          <div className="recents-list">
            {numeroRecents.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => handleOpenRecentNumero(r)}>
                <div className="recent-item-info">
                  <span className="recent-item-name">{r.name}</span>
                  <span className="recent-item-path">{r.path}</span>
                </div>
                <span className="recent-item-date">{formatDate(r.lastOpened)}</span>
                <button
                  className="recent-item-remove"
                  title={t("home:removeFromList")}
                  onClick={(e) => { e.stopPropagation(); onRemoveNumeroRecent(r.path); }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateModal
          kind="project"
          onClose={() => setShowCreate(false)}
          onCreated={onProjectOpen}
        />
      )}
      {showCreateNumero && (
        <CreateModal
          kind="numero"
          onClose={() => setShowCreateNumero(false)}
          onCreated={onNumeroOpen}
        />
      )}

      {showOpen && (
        <OpenProjectModal
          kind={showOpen}
          onSelectFolder={showOpen === "project" ? handleOpenProject : handleOpenNumero}
          onSelectFile={showOpen === "project" ? handleImportProject : handleImportNumero}
          onSelectCloud={() => setShowCloudImport(showOpen)}
          onClose={() => setShowOpen(null)}
        />
      )}

      {showCloudImport && (
        <CloudImportDialog
          kind={showCloudImport}
          onSubmit={(code) => handleCloudImportSubmit(showCloudImport, code)}
          onClose={() => setShowCloudImport(null)}
        />
      )}
    </div>
  );
}

interface CreateModalProps {
  kind: OpenKind;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

function CreateModal({ kind, onClose, onCreated }: CreateModalProps) {
  const { t } = useTranslation(["home", "common"]);
  const isShow = kind === "project";
  const [name, setName] = useState("");
  // Null until the default folder is known. The path shown is derived from it
  // and the name at each render, unless the user typed a path of their own.
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [folderOverride, setFolderOverride] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<string>(isShow ? "get_default_projects_dir" : "get_default_numeros_dir")
      .then(setBaseDir)
      .catch((err) => setError(translateError(err)));
  }, [isShow]);

  const derivedPath = baseDir === null
    ? ""
    : name.trim() === ""
      ? baseDir
      : joinPath(baseDir, folderNameFor(name, isShow ? "projet" : "numero"));
  const folderPath = folderOverride ?? derivedPath;

  async function pickFolder() {
    try {
      const path = await invoke<string | null>("pick_folder");
      if (path) {
        setBaseDir(path);
        setFolderOverride(null);
      }
    } catch (err) {
      setError(t("home:errors.folderPicker", { detail: translateError(err) }));
    }
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError(isShow ? t("home:createShow.nameRequired") : t("home:createAct.nameRequired"));
      return;
    }
    if (!folderPath.trim()) { setError(t("home:folderRequired")); return; }
    setLoading(true);
    setError("");
    try {
      const project = await invoke<Project>(isShow ? "create_project" : "create_numero", {
        name: name.trim(),
        folderPath,
      });
      onCreated(project);
    } catch (err) {
      setError(translateError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title={isShow ? t("home:createShow.title") : t("home:createAct.title")}
      onClose={onClose}
      closeOnBackdrop={name.trim() === ""}
    >
      <div className="modal-field">
        <label>{isShow ? t("home:createShow.nameLabel") : t("home:createAct.nameLabel")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isShow ? t("home:createShow.namePlaceholder") : t("home:createAct.namePlaceholder")}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
      </div>

      <div className="modal-field">
        <label>{isShow ? t("home:createShow.folderLabel") : t("home:createAct.folderLabel")}</label>
        <div className="folder-pick">
          <input
            type="text"
            value={folderPath}
            onChange={(e) => setFolderOverride(e.target.value)}
            placeholder={t("home:folderPlaceholder")}
          />
          <button className="btn-secondary" onClick={pickFolder}>{t("common:actions.browse")}</button>
        </div>
        <span style={{ fontSize: "0.78rem", color: "var(--text2)" }}>
          {t("home:folderWillBeCreated")}
        </span>
      </div>

      {error && <p className="modal-error">{error}</p>}

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>{t("common:actions.cancel")}</button>
        <button className="btn-primary" onClick={handleCreate} disabled={loading}>
          {loading ? t("common:actions.creating") : t("common:actions.create")}
        </button>
      </div>
    </Modal>
  );
}
