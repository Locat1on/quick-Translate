use crate::config::{ProviderProfile, ProviderProtocol};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranslateMode {
    Auto,
    Word,
    Paragraph,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationStartPayload {
    pub request_id: u64,
    pub source_text: String,
    pub mode: TranslateMode,
    pub provider_name: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationChunkPayload {
    pub request_id: u64,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationDonePayload {
    pub request_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationErrorPayload {
    pub request_id: u64,
    pub message: String,
}

fn build_client(proxy_url: &str) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .pool_max_idle_per_host(4)
        .tcp_keepalive(std::time::Duration::from_secs(60));
    let trimmed = proxy_url.trim();
    if !trimmed.is_empty() {
        let proxy = reqwest::Proxy::all(trimmed)
            .map_err(|e| format!("代理地址格式无效 ({trimmed}): {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("创建网络客户端失败: {e}"))
}

fn format_reqwest_error(prefix: &str, err: &reqwest::Error) -> String {
    use std::error::Error;
    let mut details = err.to_string();
    if let Some(idx) = details.find("key=") {
        let after = &details[idx + 4..];
        let end = after.find(&['&', ')'][..]).unwrap_or(after.len());
        details.replace_range(idx + 4..idx + 4 + end, "***");
    }
    let mut causes = Vec::new();
    let mut cur = err.source();
    while let Some(src) = cur {
        causes.push(src.to_string());
        cur = src.source();
    }
    if causes.is_empty() {
        format!("{prefix}: {details}")
    } else {
        format!("{prefix}: {details}\n原因: {}", causes.join(" -> "))
    }
}

pub struct TranslationManager {
    next_id: AtomicU64,
    active_abort: Mutex<Option<AbortHandle>>,
    client_cache: Mutex<Option<(String, Client)>>,
}

impl TranslationManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            active_abort: Mutex::new(None),
            client_cache: Mutex::new(None),
        }
    }

    async fn get_or_build_client(&self, proxy_url: &str) -> Result<Client, String> {
        let key = proxy_url.trim().to_string();
        {
            let guard = self.client_cache.lock().await;
            if let Some((cached_key, client)) = guard.as_ref() {
                if cached_key == &key {
                    return Ok(client.clone());
                }
            }
        }
        let client = build_client(&key)?;
        let mut guard = self.client_cache.lock().await;
        *guard = Some((key, client.clone()));
        Ok(client)
    }

    pub async fn start_translation(
        &self,
        app: AppHandle,
        provider: ProviderProfile,
        source_text: String,
        target_lang: String,
        proxy_url: String,
        mode: TranslateMode,
    ) {
        let request_id = self.next_id.fetch_add(1, Ordering::SeqCst);

        // Cancel any previous in-flight translation
        {
            let mut guard = self.active_abort.lock().await;
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }

        let effective_mode = resolve_mode(&source_text, mode);

        let _ = app.emit_to(
            "translator",
            "translation-start",
            TranslationStartPayload {
                request_id,
                source_text: source_text.clone(),
                mode: effective_mode.clone(),
                provider_name: provider.name.clone(),
                model: provider.model.clone(),
            },
        );

        if provider.api_key.trim().is_empty()
            && !matches!(provider.protocol, ProviderProtocol::OpenaiCompatible)
        {
            let _ = app.emit_to(
                "translator",
                "translation-error",
                TranslationErrorPayload {
                    request_id,
                    message: "尚未配置 API Key，请右键系统托盘图标打开「设置」填入密钥。".to_string(),
                },
            );
            return;
        }

        let client = match self.get_or_build_client(&proxy_url).await {
            Ok(c) => c,
            Err(err) => {
                let _ = app.emit_to(
                    "translator",
                    "translation-error",
                    TranslationErrorPayload {
                        request_id,
                        message: err,
                    },
                );
                return;
            }
        };
        let app_clone = app.clone();
        let handle = tokio::spawn(async move {
            let res = stream_translate(
                &client,
                &app_clone,
                request_id,
                &provider,
                &source_text,
                &target_lang,
                &effective_mode,
            )
            .await;

            match res {
                Ok(()) => {
                    let _ = app_clone.emit_to(
                        "translator",
                        "translation-done",
                        TranslationDonePayload { request_id },
                    );
                }
                Err(err) => {
                    let _ = app_clone.emit_to(
                        "translator",
                        "translation-error",
                        TranslationErrorPayload {
                            request_id,
                            message: err,
                        },
                    );
                }
            }
        });

        let mut guard = self.active_abort.lock().await;
        *guard = Some(handle.abort_handle());
    }

    pub async fn test_provider(
        &self,
        provider: ProviderProfile,
        proxy_url: String,
    ) -> Result<String, String> {
        let client = self.get_or_build_client(&proxy_url).await?;
        let prompt = "Reply with only: OK";
        match provider.protocol {
            ProviderProtocol::Gemini => {
                let base = provider.base_url.trim_end_matches('/');
                let url = format!(
                    "{}/v1beta/models/{}:generateContent?key={}",
                    base,
                    provider.model.trim(),
                    provider.api_key.trim()
                );
                let body = json!({
                    "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
                    "generationConfig": { "maxOutputTokens": 16 }
                });
                let resp = client
                    .post(&url)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| format_reqwest_error("请求失败", &e))?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    return Err(format!("HTTP {status}: {text}"));
                }
                Ok("连接成功".to_string())
            }
            ProviderProtocol::OpenaiCompatible => {
                let base = provider.base_url.trim_end_matches('/');
                let url = format!("{}/chat/completions", base);
                let mut req = client.post(&url).json(&json!({
                    "model": provider.model.trim(),
                    "messages": [{ "role": "user", "content": prompt }],
                    "max_tokens": 16
                }));
                if !provider.api_key.trim().is_empty() {
                    req = req.bearer_auth(provider.api_key.trim());
                }
                let resp = req.send().await.map_err(|e| format_reqwest_error("请求失败", &e))?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    return Err(format!("HTTP {status}: {text}"));
                }
                Ok("连接成功".to_string())
            }
            ProviderProtocol::Anthropic => {
                let base = provider.base_url.trim_end_matches('/');
                let url = format!("{}/v1/messages", base);
                let resp = client
                    .post(&url)
                    .header("x-api-key", provider.api_key.trim())
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": provider.model.trim(),
                        "max_tokens": 16,
                        "messages": [{ "role": "user", "content": prompt }]
                    }))
                    .send()
                    .await
                    .map_err(|e| format_reqwest_error("请求失败", &e))?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    return Err(format!("HTTP {status}: {text}"));
                }
                Ok("连接成功".to_string())
            }
        }
    }
}

fn resolve_mode(text: &str, mode: TranslateMode) -> TranslateMode {
    if mode != TranslateMode::Auto {
        return mode;
    }
    let trimmed = text.trim();
    let word_count = trimmed.split_whitespace().count();
    let has_cjk = trimmed.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
    if !has_cjk && word_count <= 2 && trimmed.len() <= 40 && !trimmed.contains('\n') {
        TranslateMode::Word
    } else {
        TranslateMode::Paragraph
    }
}

fn build_prompts(target_lang: &str, mode: &TranslateMode) -> (String, String) {
    let lang_directive = match target_lang.trim() {
        "" | "自动中英互译" => {
            "语言方向：若原文主要是中文，则译为地道自然的英文；若原文是英文或其他语言，则译为流畅自然的简体中文。".to_string()
        }
        other => format!("语言方向：无论原文为何种语言，均准确译为地道自然的「{other}」。"),
    };

    let system = match mode {
        TranslateMode::Word => format!(
            "你是一个简洁精准的双语词典与词汇解析助手。\n\
            {lang_directive}\n\
            请对输入的单词或短语按以下紧凑结构输出（仅使用 **粗体** 标注小标题，不要输出多余寒暄或解释）：\n\
            **音标与词性**：写出音标（英文词条）及主要词性\n\
            **核心释义**：按常用度精炼列出 1–3 个最准确义项\n\
            **常见搭配**：1–2 个高频短语搭配或词形变化（无则省略）\n\
            **双语例句**：1 句地道实用的原句及对应译文"
        ),
        _ => format!(
            "你是一位资深双语本地化与专业翻译专家。\n\
            {lang_directive}\n\
            请遵循以下原则完成翻译：\n\
            1. 意译优先、忠实原意：先通读理解上下文语境、语气（学术/技术/口语/正式）与习语隐喻，再以目标语言的地道表达重写，避免逐词硬译和翻译腔。\n\
            2. 零遗漏零杜撰：完整传达原文事实、数字、否定关系与逻辑，不删减、不脑补、不附加解释。\n\
            3. 格式与标记完整：严格保留原文段落换行、Markdown 语法、行内代码（`...`）与变量占位符。\n\
            4. 纯净输出：只输出最终译文正文，不要添加“译文：”、引号、注释或任何前后缀。"
        ),
    };
    (system, String::new())
}

async fn stream_translate(
    client: &Client,
    app: &AppHandle,
    request_id: u64,
    provider: &ProviderProfile,
    source_text: &str,
    target_lang: &str,
    mode: &TranslateMode,
) -> Result<(), String> {
    let (system_prompt, _) = build_prompts(target_lang, mode);

    match provider.protocol {
        ProviderProtocol::Gemini => {
            let base = provider.base_url.trim_end_matches('/');
            let url = format!(
                "{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
                base,
                provider.model.trim(),
                provider.api_key.trim()
            );
            let body = json!({
                "systemInstruction": { "parts": [{ "text": system_prompt }] },
                "contents": [{ "role": "user", "parts": [{ "text": source_text }] }],
                "generationConfig": { "temperature": 0.2 }
            });
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format_reqwest_error("网络请求失败", &e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Gemini API 错误 ({status}): {text}"));
            }

            consume_sse(resp, |data| {
                let v: Value = serde_json::from_str(data).ok()?;
                let parts = v.get("candidates")?.get(0)?.get("content")?.get("parts")?.as_array()?;
                let mut out = String::new();
                for part in parts {
                    if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                        out.push_str(t);
                    }
                }
                if out.is_empty() { None } else { Some(out) }
            }, app, request_id)
            .await
        }
        ProviderProtocol::OpenaiCompatible => {
            let base = provider.base_url.trim_end_matches('/');
            let url = format!("{}/chat/completions", base);
            let mut req = client.post(&url).json(&json!({
                "model": provider.model.trim(),
                "stream": true,
                "temperature": 0.2,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": source_text }
                ]
            }));
            if !provider.api_key.trim().is_empty() {
                req = req.bearer_auth(provider.api_key.trim());
            }
            let resp = req.send().await.map_err(|e| format_reqwest_error("网络请求失败", &e))?;
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("OpenAI 兼容接口错误 ({status}): {text}"));
            }

            consume_sse(resp, extract_openai_delta, app, request_id)
            .await
        }
        ProviderProtocol::Anthropic => {
            let base = provider.base_url.trim_end_matches('/');
            let url = format!("{}/v1/messages", base);
            let resp = client
                .post(&url)
                .header("x-api-key", provider.api_key.trim())
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": provider.model.trim(),
                    "max_tokens": 2048,
                    "stream": true,
                    "system": system_prompt,
                    "messages": [{ "role": "user", "content": source_text }]
                }))
                .send()
                .await
                .map_err(|e| format_reqwest_error("网络请求失败", &e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic API 错误 ({status}): {text}"));
            }

            consume_sse(resp, |data| {
                let v: Value = serde_json::from_str(data).ok()?;
                if v.get("type")?.as_str()? == "content_block_delta" {
                    let delta = v.get("delta")?.get("text")?.as_str()?;
                    if !delta.is_empty() {
                        return Some(delta.to_string());
                    }
                }
                None
            }, app, request_id)
            .await
        }
    }
}

async fn consume_sse<F>(
    resp: reqwest::Response,
    extract_delta: F,
    app: &AppHandle,
    request_id: u64,
) -> Result<(), String>
where
    F: Fn(&str) -> Option<String>,
{
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut raw_body = String::new();
    let mut emitted_count: usize = 0;

    let mut process_line = |line: &str| {
        if let Some(data) = line.strip_prefix("data:") {
            let trimmed = data.trim();
            if let Some(delta) = extract_delta(trimmed) {
                emitted_count += 1;
                let _ = app.emit_to(
                    "translator",
                    "translation-chunk",
                    TranslationChunkPayload { request_id, delta },
                );
            }
        }
    };

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("读取流数据失败: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        if raw_body.len() < 4096 {
            raw_body.push_str(&text);
        }
        buffer.push_str(&text);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer.drain(..=pos);
            process_line(&line);
        }
    }

    let trailing = buffer.trim();
    if !trailing.is_empty() {
        process_line(trailing);
    }

    if emitted_count == 0 {
        // Fallback: handle non-SSE JSON responses (e.g. relays returning HTTP 200 JSON)
        if let Ok(v) = serde_json::from_str::<Value>(raw_body.trim()) {
            let fallback_text = v
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|s| s.as_str())
                .or_else(|| {
                    v.get("candidates")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("content"))
                        .and_then(|c| c.get("parts"))
                        .and_then(|p| p.get(0))
                        .and_then(|p| p.get("text"))
                        .and_then(|s| s.as_str())
                })
                .or_else(|| {
                    v.get("content")
                        .and_then(|p| p.get(0))
                        .and_then(|p| p.get("text"))
                        .and_then(|s| s.as_str())
                });
            if let Some(text) = fallback_text.filter(|s| !s.is_empty()) {
                let _ = app.emit_to(
                    "translator",
                    "translation-chunk",
                    TranslationChunkPayload {
                        request_id,
                        delta: text.to_string(),
                    },
                );
                return Ok(());
            }
        }

        let preview: String = raw_body.trim().chars().take(360).collect();
        if preview.is_empty() {
            return Err("模型未返回任何内容，请检查模型 ID 或接口地址。".to_string());
        }
        return Err(format!("模型未返回有效译文，原始响应: {preview}"));
    }

    Ok(())
}

fn extract_openai_delta(data: &str) -> Option<String> {
    if data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;

    // 1. OpenAI Responses API format (e.g. response.output_text.delta)
    if v.get("type").and_then(|t| t.as_str()) == Some("response.output_text.delta") {
        if let Some(delta) = v.get("delta").and_then(|d| d.as_str()) {
            if !delta.is_empty() {
                return Some(delta.to_string());
            }
        }
        return None;
    }

    // 2. Standard OpenAI Chat Completions format
    let choice = v.get("choices")?.get(0)?;
    let delta = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
        .or_else(|| {
            choice
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
        })?;
    if delta.is_empty() {
        None
    } else {
        Some(delta.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{build_prompts, extract_openai_delta, TranslateMode};

    #[test]
    fn builds_distinct_target_language_prompts() {
        let (auto_p, _) = build_prompts("自动中英互译", &TranslateMode::Paragraph);
        assert!(auto_p.contains("若原文主要是中文"));

        let (en_p, _) = build_prompts("English", &TranslateMode::Paragraph);
        assert!(en_p.contains("English"));
        assert!(!en_p.contains("如果是其他语言则译为流畅自然的简体中文"));

        let (word_p, _) = build_prompts("简体中文", &TranslateMode::Word);
        assert!(word_p.contains("**核心释义**"));
    }

    #[test]
    fn parses_chat_completions_delta() {
        let line = r#"{"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(extract_openai_delta(line).as_deref(), Some("你好"));
    }

    #[test]
    fn parses_responses_api_delta() {
        let line = r#"{"type":"response.output_text.delta","delta":"现在能在 PC 上运行了吗？"}"#;
        assert_eq!(
            extract_openai_delta(line).as_deref(),
            Some("现在能在 PC 上运行了吗？")
        );
    }

    #[test]
    fn ignores_non_text_events_and_done() {
        assert_eq!(extract_openai_delta("[DONE]"), None);
        assert_eq!(
            extract_openai_delta(r#"{"type":"response.created","response":{"id":"1"}}"#),
            None
        );
    }
}
