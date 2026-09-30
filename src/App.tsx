import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { translateError } from "./errorMessage";
import { Project } from "./types";
import HomePage from "./components/HomePage";
import ProjectEditor, { EditorHandle } from "./components/ProjectEditor";
import SettingsModal from "./components/SettingsModal";
import UpdateBanner from "./components/UpdateBanner";
import Toast, { ToastData, makeToast } from "./components/Toast";
import ConfirmModal from "./components/ConfirmModal";
import { useRecentProjects } from "./useRecentProjects";
import { useRecentNumeros } from "./useRecentNumeros";
import { useSettings } from "./useSettings";
import { useUpdater } from "./useUpdater";
import "./App.css";

function App() {
  const { t } = useTranslation(["app", "updater"]);
  const [project, setProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
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
  const editorRef = useRef<EditorHandle>(null);

  // Installing an update restarts the app and cuts the music: impossible
  // while the show mode is on or a track plays, and confirmed otherwise.
  const [live, setLive] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const [confirmInstall, setConfirmInstall] = useState(false);

  function requestInstall() {
    if (!liveRef.current) setConfirmInstall(true);
  }

  async function confirmAndInstall() {
    setConfirmInstall(false);
    if (liveRef.current) return;
    if (editorRef.current && !(await editorRef.current.flushSave())) return;
    await install();
  }

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

    // A show is open and an act comes in: the editor imports it, after
    // writing its pending edits, as a step that undo can take back.
    if (current && !current.singleNumero && isNumero) {
      await editorRef.current?.importNumeroFile(path);
      return;
    }

    // Quelque chose déjà ouvert → demander confirmation avant de remplacer
    if (current) {
      const message = isRegieson
        ? (current.singleNumero
            ? t("app:replace.closeActForShow")
            : t("app:replace.replaceShow"))
        : t("app:replace.replaceAct");
      const ok = await ask(message, { title: t("app:replace.title"), kind: "warning" });
      if (!ok) return;
      // The editor is about to be replaced: its edits must be on disk first.
      // A failed write keeps it open, with its banner.
      if (editorRef.current && !(await editorRef.current.flushSave())) return;
    }

    try {
      const p = await invoke<Project>(isRegieson ? "auto_import_regieson" : "auto_import_regiesonnumero", { srcFile: path });
      // The new editor starts with the show mode off: so must the system.
      await editorRef.current?.leaveShowMode();
      if (isRegieson) handleProjectOpen(p); else handleNumeroOpen(p);
    } catch (err) {
      setToast(makeToast("error", t("app:errors.open", { detail: translateError(err) })));
    }
  }

  useEffect(() => {
    // The listener may arrive after the cleanup: it is then dropped at once.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<string>("open-file", (e) => { handleOpenFile(e.payload); })
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; })
      .catch((err) => console.error("listen open-file:", err));
    invoke<string | null>("take_pending_open_file").then((path) => {
      if (path) handleOpenFile(path);
    });
    // Background yt-dlp self-update (silent). Runs once per app launch when
    // the setting is not explicitly disabled. Failures are swallowed — the
    // existing bundled sidecar remains usable.
    if (settings.autoUpdateYtDlp !== false) {
      invoke("update_yt_dlp").catch((err) => {
        console.warn("yt-dlp auto-update failed:", err);
      });
    }
    return () => { cancelled = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      {(!live || updaterState.installing) && (
        <UpdateBanner state={updaterState} onInstall={requestInstall} onDismiss={dismiss} />
      )}
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
        // Keyed by folder: another project gets a fresh editor, with its own
        // undo history, player and show mode, instead of inheriting them.
        <ProjectEditor
          key={project.path}
          ref={editorRef}
          project={project}
          settings={settings}
          onProjectChange={setProject}
          onClose={() => setProject(null)}
          onOpenSettings={() => setShowSettings(true)}
          onLiveChange={setLive}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setShowSettings(false)}
          updaterState={updaterState}
          onCheckUpdate={checkUpdate}
          onInstallUpdate={requestInstall}
          installBlocked={live}
        />
      )}

      {confirmInstall && (
        <ConfirmModal
          title={t("updater:confirmTitle")}
          message={t("updater:confirmMessage", { version: updaterState.update?.version ?? "" })}
          confirmLabel={t("updater:confirmInstall")}
          onConfirm={() => { void confirmAndInstall(); }}
          onCancel={() => setConfirmInstall(false)}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export default App;
