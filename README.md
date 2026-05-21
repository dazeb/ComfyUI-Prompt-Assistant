
> **Prompt Assistant** — a versatile, all-in-one prompt utility for ComfyUI. One-click access to any online or local LLM for prompt translation, refinement, expansion, image/video-to-prompt reverse engineering, and prompt collections.

---

## What It Does

Prompt Assistant adds a toolbar to ComfyUI that connects your workflow nodes to LLM services (cloud or local) so you can manipulate prompts without leaving the graph.

| Feature | What |
|---------|------|
| **Translate** | Auto-detect source language, translate prompts between any languages |
| **Expand / Optimize** | Enrich short prompts into detailed, professional-grade descriptions |
| **Image Caption** | Reverse-engineer images into prompts (natural language or tag format) |
| **Video Caption** | Same for video frames — extract descriptive prompts from footage |
| **Tags & Collections** | Save, organize, and insert commonly used prompts, terms, and LoRA triggers |
| **History** | Per-input undo/redo — change tracking at the sentence level |
| **Node Help Translation** | Translate ComfyUI node documentation inline |
| **Markdown Note Translation** | Translate note and markdown nodes while preserving formatting |

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

Any OpenAI-compatible API works. Built-in examples:

| Service | Type | Notes |
|---------|------|-------|
| **Baidu Translate** | Machine translation | Free tier: 5M chars/month |
| **ZhipuAI (GLM)** | LLM | Fast, unlimited (rate-limited recently) |
| **xFlow-API** | Aggregator | One API key for Gemini, Grok, ChatGPT, etc. |
| **Ollama** | Local LLM | Run models on your own hardware |
| Custom OpenAI-compatible | Any | Bring your own endpoint |

Each feature (translate, expand, caption) can use a different service independently.

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
