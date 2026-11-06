/// Why a row cannot be evaluated. `key` names a message in the plugin's locale catalogs, `param` fills its
/// `{{name}}` placeholder, and `missing` lists undefined names the sidebar offers sliders for.
#[derive(Clone, Debug, PartialEq)]
pub struct MathError {
    pub key: &'static str,
    pub param: String,
    pub missing: Vec<String>,
}

impl MathError {
    pub fn new(key: &'static str, param: impl Into<String>) -> Self {
        Self { key, param: param.into(), missing: Vec::new() }
    }
}
