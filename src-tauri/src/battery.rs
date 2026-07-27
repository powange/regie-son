// Battery reporting, for the header indicator and the show-mode preflight.
// A laptop dying mid-show is the one failure the operator cannot recover from,
// so the autonomy estimate is worth surfacing even though the OS is not always
// willing to provide it.

use serde::Serialize;

#[derive(Serialize)]
pub struct BatteryStatus {
    // 0-100.
    pub percent: f32,
    // "charging" | "discharging" | "full" | "empty" | "unknown"
    pub state: String,
    // Autonomy left. None whenever the OS declines to estimate it, which is
    // common right after (un)plugging and permanent on some machines — the
    // frontend must treat "unknown" as a normal case, not an error.
    #[serde(rename = "secondsRemaining")]
    pub seconds_remaining: Option<f64>,
}

// Ok(None) on a machine without a battery: desktop tower, most VMs.
#[tauri::command]
pub fn get_battery_status() -> Result<Option<BatteryStatus>, String> {
    use starship_battery::units::{ratio::percent, time::second};
    use starship_battery::{Manager, State};

    let manager = Manager::new().map_err(|e| format!("Accès à la batterie : {}", e))?;
    let mut batteries = manager
        .batteries()
        .map_err(|e| format!("Énumération des batteries : {}", e))?;

    let battery = match batteries.next() {
        Some(Ok(b)) => b,
        Some(Err(e)) => return Err(format!("Lecture de la batterie : {}", e)),
        None => return Ok(None),
    };

    let state = match battery.state() {
        State::Charging => "charging",
        State::Discharging => "discharging",
        State::Full => "full",
        State::Empty => "empty",
        _ => "unknown",
    };

    // Only meaningful while running on battery; time_to_full is a different
    // question and would be misleading under the same field.
    let seconds_remaining = if battery.state() == State::Discharging {
        battery.time_to_empty().map(|t| t.get::<second>() as f64)
    } else {
        None
    };

    Ok(Some(BatteryStatus {
        percent: battery.state_of_charge().get::<percent>(),
        state: state.to_string(),
        seconds_remaining,
    }))
}
