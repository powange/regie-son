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
    use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    use windows::core::PCWSTR;

    static SILENT_WAV: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SILENT_WAV.get_or_init(build_silent_wav);

    unsafe {
        // With SND_MEMORY the first parameter is interpreted as a pointer to
        // the WAVE bytes (not as a wide-char string).
        let _ = PlaySoundW(
            PCWSTR(wav.as_ptr() as *const u16),
            None,
            SND_ASYNC | SND_MEMORY | SND_NODEFAULT,
        );
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
}

#[cfg(target_os = "windows")]
fn try_mute_system_sounds(active: bool) -> Result<bool, String> {
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

        let result = (|| -> Result<bool, String> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance : {}", e))?;

            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("GetDefaultAudioEndpoint : {}", e))?;

            let session_mgr: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioSessionManager2 : {}", e))?;

            let session_enum = session_mgr.GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator : {}", e))?;

            let count = session_enum.GetCount()
                .map_err(|e| format!("GetCount : {}", e))?;

            let mut muted_any = false;
            for i in 0..count {
                let ctrl = match session_enum.GetSession(i) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let pid = ctrl2.GetProcessId().unwrap_or(u32::MAX);
                if pid == 0 {
                    let vol: ISimpleAudioVolume = match ctrl2.cast() {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    vol.SetMute(active, std::ptr::null())
                        .map_err(|e| format!("SetMute : {}", e))?;
                    muted_any = true;
                }
            }
            Ok(muted_any)
        })();

        if should_uninit {
            CoUninitialize();
        }

        result
    }
}

#[cfg(target_os = "windows")]
fn set_show_mode_impl(active: bool) -> Result<(), String> {
    if try_mute_system_sounds(active)? {
        return Ok(());
    }
    // Session not yet materialised — play a 100 ms silent WAV via the
    // SystemSounds channel so Windows creates it, then retry once.
    nudge_system_sounds();
    if try_mute_system_sounds(active)? {
        return Ok(());
    }
    Err("Session SystemSounds introuvable. Produisez un son système (ex : notification Windows) puis réessayez.".into())
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
