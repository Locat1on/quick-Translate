<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Quick Translate Icon" width="88" height="88" />
  <h1>Quick Translate</h1>
  <p>基于 Tauri v2 与 React 构建的轻量级 Windows 划词翻译桌面应用，支持自定义大模型接口与流式输出。</p>
</div>

## 主要特性

- **全局划词与一键呼出**
  - 支持自定义全局划词翻译快捷键（默认 `Alt+Q`）与“呼出/隐藏翻译窗口”快捷键。
  - 支持键盘组合键、功能键（`F1`–`F12`）以及鼠标中键 / 侧键（`MouseMiddle` / `Mouse4` / `Mouse5`）直接点击录制。
- **多模型提供方支持**
  - **Google AI Studio (Gemini)**
  - **OpenAI 兼容接口**（支持 OpenAI、DeepSeek、Ollama 及标准 Chat Completions / `response.output_text.delta` 流式响应）
  - **Anthropic (Claude)**
  - 支持配置多个提供方随时切换、连通性测试及可选 HTTP/SOCKS 网络代理。
- **浮窗翻译体验**
  - **自动 / 词典 / 段落** 三种翻译模式即时切换；词典模式提供音标、词性、核心释义、常见搭配与双语例句。
  - 支持流式输出、原文行内编辑重译、会话内历史记录翻页（最多保留最近 10 条）、原文一键朗读（TTS）、窗口固定（Pin）以及 `Ctrl+C` 快捷复制。
- **个性化外观与系统托盘**
  - 支持浅色 / 深色 / 跟随系统主题切换，以及小 / 标准 / 大三档翻译字号实时调节。
  - 常驻系统托盘，支持开机自动启动与一键暂停/恢复全局划词。

## 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/)（18+）
- [Rust](https://www.rust-lang.org/)（Stable）与 MSVC 构建工具链
- Microsoft Edge WebView2 Runtime（Windows 11 默认内置）

## 本地开发与构建

```bash
# 安装前端依赖
npm install

# 启动开发模式（Tauri + Vite 热更新）
npm run tauri dev

# 仅构建前端并检查类型
npm run build

# 运行 Rust 单元测试
cd src-tauri && cargo test

# 打包 Windows 安装程序（NSIS）
npm run tauri build
```

## 配置文件位置

应用配置与模型提供方信息保存在本地用户目录（不会包含在代码仓库中）：

- `%APPDATA%\com.locat1on.quicktranslate\config.json`

## 项目结构

```text
quick-translate/
├── src/                        # React + TypeScript 前端界面
│   ├── components/             # 玻璃控件、快捷键录制器与动效组件
│   ├── features/
│   │   ├── translator/         # 翻译浮窗视图与流式状态管理
│   │   └── settings/           # 设置界面
│   ├── lib/                    # Tauri IPC 封装
│   └── styles/                 # 主题变量与样式
└── src-tauri/                  # Rust 后端
    └── src/
        ├── config.rs           # 配置读写与提供方管理
        ├── hotkey.rs           # 全局键盘快捷键与鼠标低级钩子
        ├── selection.rs        # 划词剪贴板捕获与恢复
        ├── translator.rs       # 多协议 SSE 流式翻译与客户端连接池
        ├── tray.rs             # 系统托盘菜单
        └── window.rs           # 浮窗定位、圆角与置顶/固定管理
```
