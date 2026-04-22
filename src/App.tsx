import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { Project } from "./types";
import HomePage from "./components/HomePage";
import ProjectEditor from "./components/ProjectEditor";
import SettingsModal from "./components/SettingsModal";
import UpdateBanner from "./components/UpdateBanner";
import { useRecentProjects } from "./useRecentProjects";
import { useRecentNumeros } from "./useRecentNumeros";
import { useSettings } from "./useSettings";
import { useUpdater } from "./useUpdater";
import "./App.css";

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const { recents, add: addRecent, remove: removeRecent } = useRecentProjects();
  const {
    recents: numeroRecents,
    add: addNumeroRecent,
    remove: removeNumeroRecent,
  } = useRecentNumeros();
  const { settings, update: updateSettings } = useSettings();
  const { state: updaterState, install, dismiss, checkUpdate } = useUpdater();

  const projectRef = useRef(project);
  projectRef.current = project;

  function handleProjectOpen(p: Project) {
    addRecent(p.name, p.path);
    setProject(p);
  }

  function handleNumeroOpen(p: Project) {
    addNumeroRecent(p.name, p.path);
    setProject(p);
  }

  async function handleOpenFile(path: string) {
    const lower = path.toLowerCase();
    const isRegieson = lower.endsWith(".regieson");
    const isNumero = lower.endsWith(".regiesonnumero");
    if (!isRegieson && !isNumero) return;

    const current = projectRef.current;

    // Projet complet déjà ouvert + .regiesonnumero → import direct dans ce projet
    if (current && !current.singleNumero && isNumero) {
      try {
        const updated = await invoke<Project>("import_numero_into_project", {
          srcFile: path,
          projectPath: current.path,
        });
        setProject(updated);
      } catch (err) {
        alert("Erreur lors de l'import : " + err);
      }
      return;
    }

    // Quelque chose déjà ouvert → demander confirmation avant de remplacer
    if (current) {
      const message = isRegieson
        ? (current.singleNumero
            ? "Un numéro est ouvert. Le fermer pour ouvrir le spectacle importé ?"
            : "Un spectacle est déjà ouvert. Le remplacer par celui importé ?")
        : "Un numéro est déjà ouvert. Le remplacer par celui importé ?";
      const ok = await ask(message, { title: "Remplacer ?", kind: "warning" });
      if (!ok) return;
    }

    try {
      if (isRegieson) {
        const p = await invoke<Project>("auto_import_regieson", { srcFile: path });
        handleProjectOpen(p);
      } else {
        const p = await invoke<Project>("auto_import_regiesonnumero", { srcFile: path });
        handleNumeroOpen(p);
      }
    } catch (err) {
      alert("Erreur à l'ouverture : " + err);
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("open-file", (e) => { handleOpenFile(e.payload); })
      .then((fn) => { unlisten = fn; });
    invoke<string | null>("take_pending_open_file").then((path) => {
      if (path) handleOpenFile(path);
    });
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <UpdateBanner state={updaterState} onInstall={install} onDismiss={dismiss} />
      {project === null ? (
        <HomePage
          recents={recents}
          numeroRecents={numeroRecents}
          onProjectOpen={handleProjectOpen}
          onNumeroOpen={handleNumeroOpen}
          onRemoveRecent={removeRecent}
          onRemoveNumeroRecent={removeNumeroRecent}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <ProjectEditor
          project={project}
          settings={settings}
          onProjectChange={setProject}
          onClose={() => setProject(null)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setShowSettings(false)}
          updaterState={updaterState}
          onCheckUpdate={checkUpdate}
          onInstallUpdate={install}
        />
      )}
    </div>
  );
}

export default App;
