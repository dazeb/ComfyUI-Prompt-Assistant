
> **Prompt Assistant** — a versatile, all-in-one prompt utility for ComfyUI. One-click access to any online or local LLM for prompt translation, refinement, expansion, image/video-to-prompt reverse engineering, and prompt collections.

---

## What It Does

Prompt Assistant adds a floating button bar to text input widgets on ComfyUI nodes. The buttons are mounted directly onto existing inputs — you don't need to click anything to "open" the assistant. It's just there.

| Button | What |
|--------|------|
| **History/Undo/Redo** | Track changes per input, undo/redo at the sentence level |
| **Tag Tool** | Search and insert prompt tags, LoRA triggers, and saved phrases at cursor position |
| **Expand** | Send the current prompt text to an LLM for expansion/optimization |
| **Translate** | Auto-detect language, translate the input text inline |

Clicking **Expand** or **Translate** sends the input text to the configured service (cloud LLM, local Ollama, or Baidu Translate) and streams the result back into the same input field, with auto-save to history for undo.

The assistant detects which rendering mode ComfyUI is using (litegraph.js canvas or Vue node2.0) and adapts its mounting strategy accordingly. It supports subgraph nodes and multiple inputs per node.

---

## How It Works

The assistant attaches a small ✨ button to supported node inputs. Clicking it opens an inline panel where you choose a service, model, and action (translate, expand, caption, etc.). Results stream back into the input.

Available prompt templates include:
- General expansion
- Portrait-specific expansion
- Danbooru-style tag expansion (SD1.5/SDXL)
- Qwen-Image-Edit instruction optimization
- Kontext instruction optimization
- Wan video prompt generation
- Pixel-level image captioning
- Image editing / inpainting instructions
- Image-to-video motion prompts

---

## Supported Services

Any OpenAI-compatible API works. Built-in providers come preconfigured:

| Service | Type | Base URL | Notes |
|---------|------|----------|-------|
| **OpenAI** | LLM + Vision | `https://api.openai.com/v1` | GPT-4o, GPT-4o-mini, o3-mini. API key or Codex OAuth. |
| **Anthropic Claude** | LLM | — | Requires an OpenAI-compatible proxy or use via OpenRouter. |
| **OpenRouter** | LLM + Vision | `https://openrouter.ai/api/v1` | 200+ models through one API. |
| **OpenCode Go** | LLM + Vision | `https://opencode.ai/go/v1` | Free high-speed inference. Models: qwen3.6-plus, deepseek-v4-flash, mimo-v2-pro. |
| **OpenCode Zen** | LLM + Vision | `https://opencode.ai/zen/v1` | Free high-speed Zen tier. Models: big-pickle, qwen3.6-plus. |
| **Ollama** | LLM + Vision | `http://localhost:11434/` | Local models. Auto-discovers installed models. |
| **Custom** | Any | Any | Add your own OpenAI-compatible endpoint. |

Each feature (translate, expand, caption) can use a different service independently. Services auto-discover available models via `GET /v1/models` where supported.

---

## Nodes

All nodes live under `✨Prompt Assistant` in the node menu.

| Node | Function |
|------|----------|
| **Prompt Translate** | Auto-detect → translate to target language |
| **Prompt Optimize** | Expand/short prompts with configurable rules |
| **Image Caption** | Image → prompt (NL or tag format) |
| **Video Caption** | Video frames → prompt |
| **Kontext Preset** | Apply preset editing instructions |

All nodes support streaming output, interrupt detection, and configurable models per-instance.

---

## Installation

### Option 1: ComfyUI Manager

Search for `Prompt Assistant` in the Manager, click Install.

### Option 2: Git Clone

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/yawiii/ComfyUI-Prompt-Assistant.git
```

Restart ComfyUI.

### Data Migration

If upgrading from v1.x:
- Old configs (API keys, custom rules, tags) are migrated automatically on first run
- User configs are stored in `ComfyUI/user/default/prompt-assistant/`
- Config templates live in the plugin's `config/` directory

---

## Configuration

1. Click the gear icon in the assistant panel to open settings
2. Add your API keys under **API Configuration**
3. Select which service to use for each feature (translate, expand, caption)
4. Choose prompt templates / rules per feature

Settings are stored locally — no external services.

---

## Project Structure

```
ComfyUI-Prompt-Assistant/
├── __init__.py           # Extension entry point, V3 node registration
├── config_manager.py     # Config file management, migration, CRUD
├── server.py             # API routes (REST endpoints for frontend)
├── config/               # Default templates (system prompts, tags, presets)
├── node/                 # ComfyUI node definitions
│   ├── base/             # Base classes (LLMNodeBase, VLMNodeBase)
│   ├── translate_node.py
│   ├── expand_node.py
│   ├── image_caption_node.py
│   ├── video_caption_node.py
│   └── kontext_preset_node.py
├── services/             # API service implementations
│   ├── llm.py            # LLM chat completions
│   ├── vlm.py            # Vision-language model calls
│   ├── baidu.py          # Baidu Translate
│   ├── openai_base.py    # OpenAI-compatible client
│   └── ollama_native.py  # Direct Ollama integration
├── utils/                # Shared utilities
├── js/                   # Frontend (ComfyUI widget extensions)
│   ├── modules/          # Feature modules (settings, tags, history, etc.)
│   ├── services/         # Frontend API clients
│   ├── utils/            # UI helpers (i18n, tooltips, popups)
│   └── css/              # Stylesheets
└── locales/              # UI translation files (en, zh, ja, ko, etc.)
```

---

## Technical Notes

- **V3 API**: Uses ComfyUI V3 extension registration (`ComfyExtension` → `get_node_list`)
- **Async**: API calls run on background threads with interrupt detection
- **Streaming**: Responses stream into the input field in real time
- **i18n**: UI supports 10+ languages via locale JSON files
- **Config**: Atomic JSON writes via temp-file + rename pattern (no corruption on crash)
- **Ollama**: Supports both native API and OpenAI-compatible mode (distinguished by base URL path)

---

## License

GNU General Public License v3. See [LICENSE](./LICENSE).
