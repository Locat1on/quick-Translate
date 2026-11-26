use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderProtocol {
    Gemini,
    OpenaiCompatible,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub protocol: ProviderProtocol,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FontSizePreset {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub shortcut: String,
    #[serde(default)]
    pub open_shortcut: String,
    pub target_lang: String,
    pub active_provider_id: String,
    pub providers: Vec<ProviderProfile>,
    pub autostart: bool,
    pub paused: bool,
    #[serde(default)]
    pub theme: ThemeMode,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub font_size: FontSizePreset,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            shortcut: "Alt+Q".to_string(),
            open_shortcut: String::new(),
            target_lang: "自动中英互译".to_string(),
            active_provider_id: "google-ai-studio".to_string(),
            providers: vec![
                ProviderProfile {
                    id: "google-ai-studio".to_string(),
                    name: "Google AI Studio (免费额度)".to_string(),
                    protocol: ProviderProtocol::Gemini,
                    base_url: "https://generativelanguage.googleapis.com".to_string(),
                    api_key: String::new(),
                    model: "gemini-2.5-flash".to_string(),
                },
                ProviderProfile {
                    id: "openai-compatible".to_string(),
                    name: "自定义 OpenAI 兼容接口".to_string(),
                    protocol: ProviderProtocol::OpenaiCompatible,
                    base_url: "https://api.openai.com/v1".to_string(),
                    api_key: String::new(),
                    model: "gpt-4o-mini".to_string(),
                },
            ],
            autostart: false,
            paused: false,
            theme: ThemeMode::System,
            proxy_url: String::new(),
            font_size: FontSizePreset::Medium,
        }
    }
}

pub struct ConfigState {
    pub inner: RwLock<AppConfig>,
    path: PathBuf,
}

impl ConfigState {
    pub fn load(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("config.json");

        let config = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
                .unwrap_or_default()
        } else {
            let default = AppConfig::default();
            if let Ok(json) = serde_json::to_string_pretty(&default) {
                let _ = fs::write(&path, json);
            }
            default
        };

        Self {
            inner: RwLock::new(config),
            path,
        }
    }

    pub fn get(&self) -> AppConfig {
        self.inner.read().unwrap().clone()
    }

    pub fn active_provider(&self) -> Option<ProviderProfile> {
        let cfg = self.inner.read().unwrap();
        cfg.providers
            .iter()
            .find(|p| p.id == cfg.active_provider_id)
            .cloned()
            .or_else(|| cfg.providers.first().cloned())
    }

    pub fn translation_context(&self) -> Option<(ProviderProfile, String, String)> {
        let cfg = self.inner.read().unwrap();
        if cfg.paused {
            return None;
        }
        let provider = cfg
            .providers
            .iter()
            .find(|p| p.id == cfg.active_provider_id)
            .or_else(|| cfg.providers.first())?
            .clone();
        Some((provider, cfg.target_lang.clone(), cfg.proxy_url.clone()))
    }

    pub fn save(&self, new_config: AppConfig) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&new_config)
            .map_err(|e| format!("序列化配置失败: {e}"))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
        }
        fs::write(&self.path, json).map_err(|e| format!("写入配置文件失败: {e}"))?;
        *self.inner.write().unwrap() = new_config;
        Ok(())
    }
}
