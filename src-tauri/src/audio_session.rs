// Windows volume mixer labelling.
//
// Audio is played by the WebView2 renderer, not by our own process, so the
// WASAPI session belongs to a `msedgewebview2.exe` child and the mixer labels
// it with that binary's file description ("Microsoft Edge WebView2").
//
// We relabel every session owned by our own process tree. The session only
// exists once audio has actually played, and Chromium tears its audio service
// down after a while and respawns it with a fresh PID, so a one-shot call at
// startup is not enough — a background thread re-applies the name periodically.

#[cfg(target_os = "windows")]
const DISPLAY_NAME: &str = "Régie Son";

#[cfg(target_os = "windows")]
const POLL: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(not(target_os = "windows"))]
pub fn start_session_namer() {}

#[cfg(target_os = "windows")]
pub fn start_session_namer() {
    std::thread::spawn(|| {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        // MTA: this thread never pumps a message loop, so an STA would risk
        // deadlocking on cross-apartment marshalling.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        // No CoUninitialize: the thread lives for the whole process lifetime.

        let display = wide(DISPLAY_NAME);
        let icon = std::env::current_exe()
            .ok()
            .map(|exe| wide(&format!("{},0", exe.display())));

        loop {
            let _ = name_own_sessions(&display, icon.as_deref());
            std::thread::sleep(POLL);
        }
    });
}

#[cfg(target_os = "windows")]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn name_own_sessions(display: &[u16], icon: Option<&[u16]>) -> Result<(), String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    use windows::core::{Interface, PCWSTR};

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| format!("CoCreateInstance : {}", e))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint : {}", e))?;

        let session_mgr: IAudioSessionManager2 = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate IAudioSessionManager2 : {}", e))?;

        let session_enum = session_mgr
            .GetSessionEnumerator()
            .map_err(|e| format!("GetSessionEnumerator : {}", e))?;

        let count = session_enum
            .GetCount()
            .map_err(|e| format!("GetCount : {}", e))?;

        // Built lazily: most polls find nothing to rename, and a ToolHelp
        // snapshot is by far the most expensive part of this pass.
        let mut tree: Option<ProcessTree> = None;

        for i in 0..count {
            let ctrl = match session_enum.GetSession(i) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let ctrl2: IAudioSessionControl2 = match ctrl.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };
            // PID 0 is the SystemSounds session — never ours.
            let pid = match ctrl2.GetProcessId() {
                Ok(p) if p != 0 => p,
                _ => continue,
            };

            if !tree.get_or_insert_with(ProcessTree::snapshot).is_ours(pid) {
                continue;
            }

            // Skip if already labelled, so we don't fire a change notification
            // (and a mixer redraw) on every poll.
            if let Ok(current) = ctrl.GetDisplayName() {
                if !current.is_null() {
                    let already = current.to_string().map(|s| s == DISPLAY_NAME).unwrap_or(false);
                    CoTaskMemFree(Some(current.0 as *const std::ffi::c_void));
                    if already {
                        continue;
                    }
                }
            }

            let _ = ctrl.SetDisplayName(PCWSTR(display.as_ptr()), std::ptr::null());
            if let Some(icon) = icon {
                let _ = ctrl.SetIconPath(PCWSTR(icon.as_ptr()), std::ptr::null());
            }
        }

        Ok(())
    }
}

// Snapshot of the child -> parent process map, used to decide whether a given
// audio session belongs to us. The WebView2 audio service is a grandchild
// (our process -> WebView2 browser process -> audio utility process), so a
// direct parent check is not enough.
#[cfg(target_os = "windows")]
struct ProcessTree {
    parents: std::collections::HashMap<u32, u32>,
    own_pid: u32,
}

#[cfg(target_os = "windows")]
impl ProcessTree {
    fn snapshot() -> Self {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        let mut parents = std::collections::HashMap::new();

        unsafe {
            if let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                let mut entry = PROCESSENTRY32W {
                    dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                    ..Default::default()
                };
                if Process32FirstW(snap, &mut entry).is_ok() {
                    loop {
                        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                        if Process32NextW(snap, &mut entry).is_err() {
                            break;
                        }
                    }
                }
                let _ = CloseHandle(snap);
            }
        }

        Self {
            parents,
            own_pid: std::process::id(),
        }
    }

    // Walk up the parent chain to our own PID. Bounded: PID reuse can leave
    // the snapshot with a cycle, and a dead parent's PID may have been handed
    // to an unrelated process.
    fn is_ours(&self, pid: u32) -> bool {
        let mut current = pid;
        for _ in 0..16 {
            if current == self.own_pid {
                return true;
            }
            match self.parents.get(&current) {
                Some(&parent) if parent != 0 && parent != current => current = parent,
                _ => return false,
            }
        }
        false
    }
}
