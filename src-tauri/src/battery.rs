// Battery reporting, for the header indicator and the show-mode preflight.
// A laptop dying mid-show is the one failure the operator cannot recover from,
// so the autonomy estimate is worth surfacing even though the OS is not always
// willing to provide it.

use serde::Serialize;

use crate::error::{fail, AppError, AppResult};

#[derive(Serialize, Debug, PartialEq)]
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

// One battery, as read from the OS.
struct Reading {
    state: &'static str,
    percent: f32,
    energy_j: f32,
    full_j: f32,
    rate_w: f32,
    seconds_to_empty: Option<f64>,
}

// Laptops with two batteries (ThinkPads) drain them one after the other: the
// first one alone would understate both the charge and the autonomy.
fn combine(readings: &[Reading]) -> Option<BatteryStatus> {
    let first = readings.first()?;
    if readings.len() == 1 {
        let seconds_remaining = (first.state == "discharging")
            .then_some(first.seconds_to_empty)
            .flatten();
        return Some(BatteryStatus {
            percent: first.percent,
            state: first.state.to_string(),
            seconds_remaining,
        });
    }

    let any = |s: &str| readings.iter().any(|r| r.state == s);
    let all = |s: &str| readings.iter().all(|r| r.state == s);
    let state = if any("discharging") {
        "discharging"
    } else if any("charging") {
        "charging"
    } else if all("full") {
        "full"
    } else if all("empty") {
        "empty"
    } else {
        "unknown"
    };

    let energy: f32 = readings.iter().map(|r| r.energy_j).sum();
    let full: f32 = readings.iter().map(|r| r.full_j).sum();
    let percent = if full > 0.0 {
        (energy / full * 100.0).clamp(0.0, 100.0)
    } else {
        readings.iter().map(|r| r.percent).sum::<f32>() / readings.len() as f32
    };

    // All the energy left, drained at the combined rate of the batteries
    // being used.
    let draw: f32 = readings
        .iter()
        .filter(|r| r.state == "discharging")
        .map(|r| r.rate_w)
        .sum();
    let seconds_remaining =
        (state == "discharging" && draw > 0.0).then(|| f64::from(energy) / f64::from(draw));

    Some(BatteryStatus {
        percent,
        state: state.to_string(),
        seconds_remaining,
    })
}

// Ok(None) on a machine without a battery: desktop tower, most VMs.
#[tauri::command(async)]
pub fn get_battery_status() -> AppResult<Option<BatteryStatus>> {
    #[cfg(desktop)]
    {
        read_batteries()
    }
    // starship-battery does not build for Android; its BatteryManager reading
    // comes with the show-mode plugin (Android plan, step 4).
    #[cfg(mobile)]
    {
        Ok(None)
    }
}

#[cfg(desktop)]
fn read_batteries() -> AppResult<Option<BatteryStatus>> {
    use starship_battery::units::{energy::joule, power::watt, ratio::percent, time::second};
    use starship_battery::{Manager, State};

    let manager = Manager::new().map_err(fail("battery.accessFailed"))?;
    let batteries = manager
        .batteries()
        .map_err(fail("battery.enumerateFailed"))?;

    let mut readings = Vec::new();
    let mut first_error = None;
    for battery in batteries {
        let battery = match battery {
            Ok(b) => b,
            Err(e) => {
                first_error.get_or_insert(e);
                continue;
            }
        };
        let state = match battery.state() {
            State::Charging => "charging",
            State::Discharging => "discharging",
            State::Full => "full",
            State::Empty => "empty",
            _ => "unknown",
        };
        readings.push(Reading {
            state,
            percent: battery.state_of_charge().get::<percent>(),
            energy_j: battery.energy().get::<joule>(),
            full_j: battery.energy_full().get::<joule>(),
            rate_w: battery.energy_rate().get::<watt>().abs(),
            // time_to_full is a different question and would be misleading
            // under the same field.
            seconds_to_empty: battery.time_to_empty().map(|t| t.get::<second>() as f64),
        });
    }

    match (combine(&readings), first_error) {
        (Some(status), _) => Ok(Some(status)),
        (None, Some(e)) => Err(AppError::new("battery.readFailed").detail(e)),
        (None, None) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(state: &'static str, energy_j: f32, full_j: f32, rate_w: f32) -> Reading {
        Reading {
            state,
            percent: energy_j / full_j * 100.0,
            energy_j,
            full_j,
            rate_w,
            seconds_to_empty: Some(123.0),
        }
    }

    #[test]
    fn one_battery_is_reported_as_the_os_sees_it() {
        let status = combine(&[reading("discharging", 50.0, 100.0, 10.0)]).unwrap();
        assert_eq!(status.percent, 50.0);
        assert_eq!(status.seconds_remaining, Some(123.0));
        let status = combine(&[reading("charging", 50.0, 100.0, 10.0)]).unwrap();
        assert_eq!(status.seconds_remaining, None);
        assert!(combine(&[]).is_none());
    }

    #[test]
    fn two_batteries_add_up() {
        // The internal battery idles while the external one drains.
        let status = combine(&[
            reading("unknown", 20_000.0, 80_000.0, 0.0),
            reading("discharging", 60_000.0, 80_000.0, 10.0),
        ])
        .unwrap();
        assert_eq!(status.state, "discharging");
        assert_eq!(status.percent, 50.0);
        assert_eq!(status.seconds_remaining, Some(8_000.0));

        let status = combine(&[
            reading("full", 80_000.0, 80_000.0, 0.0),
            reading("full", 80_000.0, 80_000.0, 0.0),
        ])
        .unwrap();
        assert_eq!((status.state.as_str(), status.percent), ("full", 100.0));
        assert_eq!(status.seconds_remaining, None);
    }
}
