use std::fs;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;

#[tauri::command]
pub fn set_show_mode(active: bool) -> Result<(), String> {
    set_show_mode_impl(active)
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
    wav.extend_from_slice(&1u16.to_le_bytes());        // PCM
    wav.extend_from_slice(&1u16.to_le_bytes());        // mono
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend(std::iter::repeat(0u8).take(data_size as usize));
    wav
}

#[cfg(target_os = "windows")]
fn nudge_system_sounds() {
    use std::sync::OnceLock;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_MEMORY, SND_NODEFAULT, SND_SYNC};
    use windows::core::PCWSTR;

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
    session_count: u32,
}

#[cfg(target_os = "windows")]
fn try_mute_system_sounds(active: bool) -> Result<MuteOutcome, String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::core::Interface;

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();

        let result = (|| -> Result<MuteOutcome, String> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance : {}", e))?;

            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint : {}", e))?;

            let session_mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioSessionManager2 : {}", e))?;

            let session_enum = session_mgr.GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator : {}", e))?;

            let count = session_enum.GetCount()
                .map_err(|e| format!("GetCount : {}", e))? as u32;

            let mut muted_any = false;
            for i in 0..(count as i32) {
                let ctrl = match session_enum.GetSession(i) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                // IsSystemSoundsSession() is the documented way to identify
                // the SystemSounds session. It returns S_OK when true.
                // Falls back to PID == 0 in case the API surface changes.
                let is_system = ctrl2.IsSystemSoundsSession().is_ok()
                    || ctrl2.GetProcessId().map(|p| p == 0).unwrap_or(false);
                if is_system {
                    let vol: ISimpleAudioVolume = match ctrl2.cast() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    vol.SetMute(active, std::ptr::null())
                        .map_err(|e| format!("SetMute : {}", e))?;
                    muted_any = true;
                }
            }
            Ok(MuteOutcome { muted: muted_any, session_count: count })
        })();

        if should_uninit {
            CoUninitialize();
        }

        result
    }
}

#[cfg(target_os = "windows")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    let first = try_mute_system_sounds(active)?;
    if first.muted {
        return Ok(());
    }
    // Session not yet materialised — play 100 ms of silent WAV through the
    // SystemSounds channel so Windows creates it, then retry once.
    nudge_system_sounds();
    let second = try_mute_system_sounds(active)?;
    if second.muted {
        return Ok(());
    }
    Err(format!(
        "Session SystemSounds introuvable après réveil ({} sessions audio vues). \
         Essayez de jouer un son Windows (notification, ding) puis recliquez.",
        second.session_count
    ))
}

#[cfg(target_os = "macos")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    // Essayer AppleScript (macOS ≤ 12)
    let value = if active { "true" } else { "false" };
    let script = format!("tell application \"System Events\" to set Do Not Disturb to {}", value);
    if let Ok(out) = Command::new("osascript").args(["-e", &script]).output() {
        if out.status.success() { return Ok(()); }
    }
    // Fallback defaults + redémarrage NotificationCenter (macOS 12+)
    let bool_val = if active { "YES" } else { "NO" };
    let out = Command::new("defaults")
        .args(["-currentHost", "write", "com.apple.notificationcenterui", "doNotDisturb", "-boolean", bool_val])
        .output()
        .map_err(|e| format!("Erreur : {}", e))?;
    if out.status.success() {
        let _ = Command::new("killall").arg("NotificationCenter").output();
        Ok(())
    } else {
        Err("Activez manuellement le mode Ne pas déranger dans Réglages Système > Notifications.".into())
    }
}

#[cfg(target_os = "linux")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    // GNOME : inverser show-banners (false = muet)
    let value = if active { "false" } else { "true" };
    let out = Command::new("gsettings")
        .args(["set", "org.gnome.desktop.notifications", "show-banners", value])
        .output()
        .map_err(|_| "gsettings non disponible. Activez manuellement le mode Ne pas déranger.".to_string())?;
    if out.status.success() { Ok(()) } else {
        Err("Impossible de modifier les notifications GNOME. Activez manuellement le mode Ne pas déranger.".into())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn set_show_mode_impl(_active: bool) -> Result<(), String> {
    Err("Mode spectacle non supporté sur cet OS.".into())
}

pub fn configure_wsl2_audio() {
    if !fs::read_to_string("/proc/version").unwrap_or_default().to_lowercase().contains("microsoft") {
        return;
    }
    std::env::set_var("PULSE_LATENCY_MSEC", "500");
}
