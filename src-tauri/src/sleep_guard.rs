// Empêche la mise en veille pendant un spectacle.
//
// Chaque backend est construit pour se relâcher tout seul si l'application
// meurt sans avoir désactivé le mode spectacle : sous Windows le drapeau est
// porté par un thread qui nous appartient, sous macOS et Linux par un
// processus fils dont la durée de vie est arrimée à la nôtre. Un plantage ne
// peut donc pas laisser la machine éveillée indéfiniment.

pub fn set_sleep_inhibited(active: bool) -> Result<(), String> {
    imp::set(active)
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::mpsc::{self, Sender};
    use std::sync::Mutex;
    use std::thread;

    // Moitié émettrice du canal sur lequel le thread gardien est parqué. La
    // laisser tomber ferme le canal, ce qui est notre façon de lui dire de
    // rendre la main.
    static GUARD: Mutex<Option<Sender<()>>> = Mutex::new(None);

    pub fn set(active: bool) -> Result<(), String> {
        let mut guard = GUARD.lock().unwrap_or_else(|e| e.into_inner());

        if !active {
            drop(guard.take());
            return Ok(());
        }
        if guard.is_some() {
            return Ok(());
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        thread::spawn(move || {
            use windows::Win32::System::Power::{
                SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
                EXECUTION_STATE,
            };

            // ES_CONTINUOUS s'applique au thread appelant et ne vit pas plus
            // longtemps que lui. Impossible donc de le poser depuis le thread
            // de la commande Tauri : il est recyclé et emporterait le drapeau
            // avec lui. D'où ce thread à nous, parqué jusqu'à la fin du
            // spectacle.
            let previous = unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
            };
            // 0 est la seule valeur d'échec documentée.
            if previous == EXECUTION_STATE::default() {
                let _ = ready_tx.send(Err(
                    "Impossible d'empêcher la mise en veille (SetThreadExecutionState a échoué)."
                        .into(),
                ));
                return;
            }
            let _ = ready_tx.send(Ok(()));

            // recv() rend Err dès que l'émetteur est lâché, que ce soit à la
            // désactivation ou à la destruction du processus.
            let _ = stop_rx.recv();
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {
                *guard = Some(stop_tx);
                Ok(())
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("Impossible d'empêcher la mise en veille (thread interrompu).".into()),
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::process::{Child, Command, Stdio};
    use std::sync::Mutex;

    static GUARD: Mutex<Option<Child>> = Mutex::new(None);

    pub fn set(active: bool) -> Result<(), String> {
        let mut guard = GUARD.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if !active {
            return Ok(());
        }

        // -d écran, -i veille système par inactivité, -m disques, -s veille
        // système sur secteur. -w arrime caffeinate à notre PID : s'il n'y a
        // personne pour le tuer, il s'arrête quand l'application s'arrête.
        let child = Command::new("caffeinate")
            .args(["-d", "-i", "-m", "-s", "-w", &std::process::id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!(
                    "Impossible d'empêcher la mise en veille (caffeinate : {}). \
                     Désactivez la veille manuellement dans Réglages Système > Batterie.",
                    e
                )
            })?;

        *guard = Some(child);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::io::Read;
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    // Au-delà de ce délai sans nouvelle du fils, on considère que logind ne
    // répondra pas (bus injoignable, autorisation en attente) et on renonce.
    const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);

    static GUARD: Mutex<Option<Child>> = Mutex::new(None);

    pub fn set(active: bool) -> Result<(), String> {
        let mut guard = GUARD.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(mut child) = guard.take() {
            // Fermer notre bout du tube donne un EOF à `cat`, ce qui relâche
            // le verrou proprement ; le kill n'est qu'un filet de sécurité.
            drop(child.stdin.take());
            let _ = child.kill();
            let _ = child.wait();
        }
        if !active {
            return Ok(());
        }

        // `cat` tient le verrou ouvert tant qu'il lit un tube dont nous
        // gardons l'autre extrémité. On n'y écrit jamais rien : ce qui compte
        // est que le verrou soit relâché sur EOF, ce qui arrive aussi bien à
        // la désactivation qu'à la mort du processus.
        //
        // Le `echo` qui le précède est une poignée de main : systemd-inhibit
        // ne lance la commande qu'une fois le verrou obtenu, donc le premier
        // octet reçu sur sa sortie est la preuve que le verrou est tenu. Un
        // simple délai ne prouverait rien — il laisserait passer les échecs
        // lents (bus qui traîne, autorisation en attente), et un échec
        // silencieux ici veut dire un portable qui s'endort en plein
        // spectacle.
        let mut child = Command::new("systemd-inhibit")
            .args([
                "--what=idle:sleep:handle-lid-switch",
                "--who=Régie Son",
                "--why=Spectacle en cours",
                "--mode=block",
                "sh",
                "-c",
                "echo held; exec cat",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| {
                "Impossible d'empêcher la mise en veille : systemd-inhibit est introuvable. \
                 Désactivez la veille manuellement."
                    .to_string()
            })?;

        // La lecture est déportée sur un thread : c'est le seul moyen de lui
        // imposer un délai maximal, un tube n'ayant pas de lecture bornée dans
        // le temps en std.
        let mut stdout = match child.stdout.take() {
            Some(s) => s,
            None => return Err("Impossible d'empêcher la mise en veille (tube absent).".into()),
        };
        let (tx, rx) = mpsc::channel::<bool>();
        thread::spawn(move || {
            let mut buf = [0u8; 4];
            // 0 octet lu = fin de fichier : systemd-inhibit a rendu la main
            // sans jamais lancer la commande, donc sans avoir pris le verrou.
            let _ = tx.send(stdout.read(&mut buf).map(|n| n > 0).unwrap_or(false));
        });

        if rx.recv_timeout(HANDSHAKE_TIMEOUT) == Ok(true) {
            *guard = Some(child);
            return Ok(());
        }

        // Échec ou silence : on tue avant de lire stderr, sinon l'attente ne
        // rendrait jamais la main dans le cas où le fils est encore vivant.
        let _ = child.kill();
        let detail = child
            .wait_with_output()
            .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
            .unwrap_or_default();
        Err(format!(
            "Impossible d'empêcher la mise en veille : systemd-inhibit n'a pas pris le \
             verrou{}. Désactivez la veille manuellement.",
            if detail.is_empty() {
                String::new()
            } else {
                format!(" ({})", detail)
            }
        ))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
mod imp {
    pub fn set(_active: bool) -> Result<(), String> {
        Err("Blocage de la mise en veille non supporté sur cet OS.".into())
    }
}
