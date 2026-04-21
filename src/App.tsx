import { useState } from "react";
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

  function handleProjectOpen(p: Project) {
    addRecent(p.name, p.path);
    setProject(p);
  }

  function handleNumeroOpen(p: Project) {
    addNumeroRecent(p.name, p.path);
    setProject(p);
  }

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
