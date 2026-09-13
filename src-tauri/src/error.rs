use std::collections::BTreeMap;
use std::fmt;

use serde::Serialize;

/// Erreur remontée au frontend. `code` désigne une entrée du catalogue
/// `src/i18n/locales/*/errors.json` : c'est là que vit la phrase, pas ici.
///
/// `detail` porte le message brut de l'OS ou de la bibliothèque et n'est jamais
/// traduit. C'est ce qu'on lit pour déboguer, et c'est aussi ce sur quoi le
/// frontend fait ses regex de reconnaissance (sortie de yt-dlp, erreurs
/// reqwest) — qui sont en anglais, et qui le restent.
#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<&'static str, String>,
}

impl AppError {
    pub fn new(code: &'static str) -> Self {
        AppError { code, detail: None, params: BTreeMap::new() }
    }

    pub fn detail(mut self, detail: impl fmt::Display) -> Self {
        self.detail = Some(detail.to_string());
        self
    }

    /// Paramètre d'interpolation du message traduit (`{{name}}`, `{{status}}`…).
    pub fn with(mut self, key: &'static str, value: impl fmt::Display) -> Self {
        self.params.insert(key, value.to_string());
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(detail) = &self.detail {
            write!(f, ": {}", detail)?;
        }
        Ok(())
    }
}

impl std::error::Error for AppError {}

/// Raccourci pour `.map_err(...)` : le message brut devient le `detail`.
///
/// ```ignore
/// fs::write(&path, data).map_err(fail("io.saveFailed"))?;
/// ```
pub fn fail<E: fmt::Display>(code: &'static str) -> impl FnOnce(E) -> AppError {
    move |e| AppError::new(code).detail(e)
}

/// Raccourci pour `.ok_or_else(...)` sur un `Option`, sans détail à rapporter.
pub fn missing(code: &'static str) -> impl FnOnce() -> AppError {
    move || AppError::new(code)
}

pub type AppResult<T> = Result<T, AppError>;
