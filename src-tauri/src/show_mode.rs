use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::error::{AppError, AppResult};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;

// Everything show mode changed, so that it can be undone exactly. One lock
// covers a whole toggle: without it an activation that takes 500 ms on
// Windows could finish after the deactivation clicked right behind it, and
// leave notifications muted while the UI shows show mode off.
struct ShowModeState {
    active: bool,
    // Some(previously muted) while notifications are muted by us.
    muted_before: Option<bool>,
    // Records muted_before on disk, so that a crash is undone at next launch.
    marker: Option<PathBuf>,
}

static STATE: Mutex<ShowModeState> = Mutex::new(ShowModeState {
    active: false,
    muted_before: None,
    marker: None,
});

fn lock_state() -> MutexGuard<'static, ShowModeState> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn write_marker(path: &Path, muted_before: bool) {
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, if muted_before { "1" } else { "0" }).is_ok() {
        let _ = fs::rename(&tmp, path);
    }
}

/// Called once at startup. A marker left behind means the app died with
/// notifications muted: put them back as they were before that show.
pub fn init(data_dir: PathBuf) {
    std::thread::spawn(move || {
        let mut state = lock_state();
        let marker = data_dir.join("show-mode-notifications");
        state.marker = Some(marker.clone());
        if let Ok(saved) = fs::read_to_string(&marker) {
            if set_notifications_muted(saved.trim() == "1").is_ok() {
                let _ = fs::remove_file(&marker);
            }
        }
    });
}

fn mute_notifications(state: &mut ShowModeState) -> AppResult<()> {
    if state.muted_before.is_some() {
        return Ok(());
    }
    let before = set_notifications_muted(true)?;
    state.muted_before = Some(before);
    if let Some(marker) = &state.marker {
        write_marker(marker, before);
    }
    Ok(())
}

// Puts back the setting found at activation instead of forcing notifications
// on: a user who keeps banners or system sounds off gets them back off.
fn restore_notifications(state: &mut ShowModeState) -> AppResult<()> {
    let Some(before) = state.muted_before else {
        return Ok(());
    };
    set_notifications_muted(before)?;
    state.muted_before = None;
    if let Some(marker) = &state.marker {
        let _ = fs::remove_file(marker);
    }
    Ok(())
}

// `async` sans fonction async : les commandes non-async tournent sur le thread
// principal, et les deux volets bloquent — réveil de la session SystemSounds
// sous Windows (~500 ms), poignée de main avec systemd-inhibit sous Linux.
// Sans cet attribut, l'interface se fige à chaque bascule du mode spectacle.
#[tauri::command(async)]
pub fn set_show_mode(active: bool) -> Result<(), Vec<AppError>> {
    let mut state = lock_state();
    // Les deux volets sont toujours tentés, même si l'autre échoue : un
    // spectacle qui se joue avec les notifications encore audibles n'est pas
    // le même problème qu'un spectacle joué sur une machine qui peut encore
    // s'endormir, et l'opérateur doit savoir lequel des deux a renoncé.
    let notifications = if active {
        mute_notifications(&mut state)
    } else {
        restore_notifications(&mut state)
    };
    let sleep = crate::sleep_guard::set_sleep_inhibited(active);
    state.active = active;

    let errors: Vec<AppError> = [notifications.err(), sleep.err()]
        .into_iter()
        .flatten()
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Closing the window or quitting (Cmd+Q, Alt+F4) skips the editor's own
/// deactivation: undo show mode here, on the way out.
pub fn release_on_exit() {
    let mut state = lock_state();
    if state.active || state.muted_before.is_some() {
        let _ = restore_notifications(&mut state);
        let _ = crate::sleep_guard::set_sleep_inhibited(false);
        state.active = false;
    }
}

#[cfg(target_os = "windows")]
fn build_silent_wav() -> Vec<u8> {
    // 100 ms of 16-bit mono silence at 22050 Hz, used to materialise the
    // SystemSounds session without any audible output.
    let sample_rate: u32 = 22050;
    let num_samples: u32 = sample_rate / 10;
    let data_size: u32 = num_samples * 2;
    let total_size: u32 = 36 + data_size;
    let mut wav = Vec::with_capacity(44 + data_size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&total_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend(std::iter::repeat_n(0u8, data_size as usize));
    wav
}

#[cfg(target_os = "windows")]
fn nudge_system_sounds() {
    use std::sync::OnceLock;
    use windows::core::PCWSTR;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_MEMORY, SND_NODEFAULT, SND_SYNC};

    static SILENT_WAV: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SILENT_WAV.get_or_init(build_silent_wav);

    unsafe {
        // SND_MEMORY: the first parameter is a pointer to the WAVE bytes.
        // SND_SYNC blocks until playback finishes (~100 ms) so the session
        // is materialised before we re-enumerate.
        let _ = PlaySoundW(
            PCWSTR(wav.as_ptr() as *const u16),
            None,
            SND_SYNC | SND_MEMORY | SND_NODEFAULT,
        );
    }
    // Extra margin in case Windows registers the session asynchronously.
    std::thread::sleep(std::time::Duration::from_millis(400));
}

// Result of a single mute attempt. `count` is the total sessions seen,
// useful to surface in the user-facing error if we never find SystemSounds.
#[cfg(target_os = "windows")]
struct MuteOutcome {
    muted: bool,
    was_muted: bool,
    session_count: u32,
}

#[cfg(target_os = "windows")]
fn try_mute_system_sounds(mute: bool) -> AppResult<MuteOutcome> {
    use windows::core::Interface;
    use windows::Win32::Foundation::S_OK;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();

        let result = (|| -> AppResult<MuteOutcome> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| {
                    AppError::new("showMode.audioApiFailed")
                        .with("api", "CoCreateInstance")
                        .detail(e)
                })?;

            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| {
                    AppError::new("showMode.audioApiFailed")
                        .with("api", "GetDefaultAudioEndpoint")
                        .detail(e)
                })?;

            let session_mgr: IAudioSessionManager2 =
                device.Activate(CLSCTX_ALL, None).map_err(|e| {
                    AppError::new("showMode.audioApiFailed")
                        .with("api", "Activate IAudioSessionManager2")
                        .detail(e)
                })?;

            let session_enum = session_mgr.GetSessionEnumerator().map_err(|e| {
                AppError::new("showMode.audioApiFailed")
                    .with("api", "GetSessionEnumerator")
                    .detail(e)
            })?;

            let count = session_enum.GetCount().map_err(|e| {
                AppError::new("showMode.audioApiFailed")
                    .with("api", "GetCount")
                    .detail(e)
            })? as u32;

            let mut muted_any = false;
            let mut was_muted = false;
            let mut tree: Option<crate::audio_session::ProcessTree> = None;
            for i in 0..(count as i32) {
                let ctrl = match session_enum.GetSession(i) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let pid = ctrl2.GetProcessId().ok();

                // Safety net, independent of the detection below: our own
                // playback runs through the WebView2 child process, and muting
                // it would silence the show itself.
                if let Some(p) = pid {
                    if p != 0
                        && tree
                            .get_or_insert_with(crate::audio_session::ProcessTree::snapshot)
                            .is_ours(p)
                    {
                        continue;
                    }
                }

                // IsSystemSoundsSession() returns S_OK for the system session
                // and S_FALSE for every other one. Both are success codes, so
                // windows-rs projects them to Ok(()) alike — testing .is_ok()
                // matches every session on the endpoint and mutes the whole
                // machine. Compare the raw HRESULT instead.
                let hr =
                    (Interface::vtable(&ctrl2).IsSystemSoundsSession)(Interface::as_raw(&ctrl2));
                let is_system = hr == S_OK || pid == Some(0);
                if is_system {
                    let vol: ISimpleAudioVolume = match ctrl2.cast() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    was_muted |= vol.GetMute().map(|m| m.as_bool()).unwrap_or(false);
                    vol.SetMute(mute, std::ptr::null()).map_err(|e| {
                        AppError::new("showMode.audioApiFailed")
                            .with("api", "SetMute")
                            .detail(e)
                    })?;
                    muted_any = true;
                }
            }
            Ok(MuteOutcome {
                muted: muted_any,
                was_muted,
                session_count: count,
            })
        })();

        if should_uninit {
            CoUninitialize();
        }

        result
    }
}

/// Mutes or unmutes notifications and returns whether they were muted before.
#[cfg(target_os = "windows")]
fn set_notifications_muted(mute: bool) -> AppResult<bool> {
    let first = try_mute_system_sounds(mute)?;
    if first.muted {
        return Ok(first.was_muted);
    }
    // Session not yet materialised — play 100 ms of silent WAV through the
    // SystemSounds channel so Windows creates it, then retry once.
    nudge_system_sounds();
    let second = try_mute_system_sounds(mute)?;
    if second.muted {
        return Ok(second.was_muted);
    }
    Err(AppError::new("showMode.systemSoundsNotFound").with("count", second.session_count))
}

#[cfg(any(target_os = "macos", test))]
fn parse_major_version(version: &str) -> Option<u32> {
    version.trim().split('.').next()?.parse().ok()
}

#[cfg(target_os = "macos")]
fn set_notifications_muted(mute: bool) -> AppResult<bool> {
    // Since Monterey (12), Focus replaced the doNotDisturb preference: writing
    // it still succeeds but no longer silences anything. Say so rather than
    // report a success that did not happen.
    let major = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|o| parse_major_version(&String::from_utf8_lossy(&o.stdout)));
    if major.is_none_or(|v| v >= 12) {
        return Err(AppError::new("showMode.macosManual"));
    }

    let before = Command::new("defaults")
        .args([
            "-currentHost",
            "read",
            "com.apple.notificationcenterui",
            "doNotDisturb",
        ])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "1");

    let bool_val = if mute { "YES" } else { "NO" };
    let out = Command::new("defaults")
        .args([
            "-currentHost",
            "write",
            "com.apple.notificationcenterui",
            "doNotDisturb",
            "-boolean",
            bool_val,
        ])
        .output()
        .map_err(|e| AppError::new("showMode.appleScriptFailed").detail(e))?;
    if out.status.success() {
        let _ = Command::new("killall").arg("NotificationCenter").output();
        Ok(before)
    } else {
        Err(AppError::new("showMode.macosManual"))
    }
}

// Only GNOME honours org.gnome.desktop.notifications: under KDE or XFCE the
// schema may be installed and `gsettings set` succeeds without silencing
// anything. XDG_CURRENT_DESKTOP is a colon-separated list ("ubuntu:GNOME").
#[cfg(any(target_os = "linux", test))]
fn is_gnome_desktop(xdg_current_desktop: &str) -> bool {
    xdg_current_desktop
        .split(':')
        .any(|d| d.eq_ignore_ascii_case("GNOME"))
}

#[cfg(target_os = "linux")]
fn set_notifications_muted(mute: bool) -> AppResult<bool> {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !is_gnome_desktop(&desktop) {
        return Err(AppError::new("showMode.desktopUnsupported").with(
            "desktop",
            if desktop.is_empty() {
                "?"
            } else {
                desktop.as_str()
            },
        ));
    }
    let schema = "org.gnome.desktop.notifications";
    // show-banners=false is GNOME's Do Not Disturb.
    let before = Command::new("gsettings")
        .args(["get", schema, "show-banners"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "false");
    let value = if mute { "false" } else { "true" };
    let out = Command::new("gsettings")
        .args(["set", schema, "show-banners", value])
        .output()
        .map_err(|_| AppError::new("showMode.gsettingsMissing"))?;
    if out.status.success() {
        Ok(before)
    } else {
        Err(AppError::new("showMode.gnomeFailed"))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn set_notifications_muted(_mute: bool) -> AppResult<bool> {
    Err(AppError::new("showMode.unsupportedOs"))
}

pub fn configure_wsl2_audio() {
    if !fs::read_to_string("/proc/version")
        .unwrap_or_default()
        .to_lowercase()
        .contains("microsoft")
    {
        return;
    }
    std::env::set_var("PULSE_LATENCY_MSEC", "500");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_gnome_gets_gsettings() {
        assert!(is_gnome_desktop("GNOME"));
        assert!(is_gnome_desktop("ubuntu:GNOME"));
        assert!(is_gnome_desktop("Pop:GNOME"));
        assert!(!is_gnome_desktop("KDE"));
        assert!(!is_gnome_desktop("XFCE"));
        assert!(!is_gnome_desktop("X-Cinnamon"));
        assert!(!is_gnome_desktop(""));
    }

    #[test]
    fn macos_major_version() {
        assert_eq!(parse_major_version("11.7.10\n"), Some(11));
        assert_eq!(parse_major_version("14.2.1"), Some(14));
        assert_eq!(parse_major_version(""), None);
    }
}
