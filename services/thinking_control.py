"""
Thinking-control parameter registry.

This module only decides which request parameter should be sent to suppress
model reasoning. Transport, retry, and final output filtering live elsewhere.
Keep rules conservative: add a request parameter only when the provider/model
family has a known control surface. Unsupported parameters are removed by the
OpenAI-compatible degradation path.
"""

import re
from copy import deepcopy
from typing import Any, Dict, List


THINKING_CONTROL_RULES: List[Dict[str, Any]] = [
    {
        "name": "zai_glm_thinking",
        "description": "GLM/Z.AI models with thinking.type control",
        "patterns": [
            r"glm[-_/.]?(4\.5|4\.6|4\.7|5)",
            r"glm[-_/.]?4\.5v",
        ],
        "params": {"thinking": {"type": "disabled"}},
        "sources": ["Z.AI Thinking Mode"],
    },
    {
        "name": "qwen_enable_thinking",
        "description": "Qwen3/Qwen-VL endpoints that accept enable_thinking",
        "patterns": [
            r"qwen[-_/.]?3(?!.*r1)",
            r"qwen.*[-_/.]?vl",
        ],
        "params": {"enable_thinking": False},
        "sources": ["Qwen/DashScope OpenAI-compatible API"],
    },
    {
        "name": "deepseek_thinking",
        "description": "DeepSeek endpoints that accept thinking.type",
        "patterns": [
            r"deepseek[-_/.]?(chat|v3)(?!.*r1)",
        ],
        "params": {"thinking": {"type": "disabled"}},
        "sources": ["DeepSeek thinking mode API"],
    },
    {
        "name": "gemini_flash_reasoning",
        "description": "Gemini Flash/Lite via OpenAI-compatible proxies",
        "patterns": [
            r"gemini[-_/.]?2\.(0|5)[-_/.]?(flash|lite)",
        ],
        "params": {"reasoning_effort": "none"},
        "sources": ["OpenAI-compatible Gemini proxies"],
    },
]


OLLAMA_NATIVE_RULES = {
    "parameter_name": "think",
    "disable_value": False,
    "enable_value": True,
    "supported_patterns": [
        r"deepseek.*(r1|v3)",
        r"qwen.*(3|r1|thinking|vl)",
        r".*thinking",
    ],
    "sources": ["Ollama /api/chat think parameter"],
}


OLLAMA_NATIVE_EXCLUDE_PATTERNS = [
    # Community abliterated/uncensored vision variants often expose Qwen names
    # but do not consistently follow Ollama's native thinking contract.
    r"abliterated",
    r"uncensored",
]


EXCLUDE_PATTERNS = [
    # Google states these cannot be fully disabled; final filtering is the fallback.
    r"gemini[-_/.]?2\.5[-_/.]?pro",
    r"gemini[-_/.]?3[-_/.]?pro",
    # xAI reasoning models currently do not expose a reliable off switch.
    r"grok.*reason",
    r"grok[-_/.]?4",
    # Ollama GPT-OSS accepts only low/medium/high and cannot be fully disabled.
    r"gpt[-_/.]?oss",
    # Reasoning-only families should not be forced with guessed parameters.
    r".*speciale",
]


def _matches(patterns: List[str], model_lower: str) -> bool:
    return any(re.search(pattern, model_lower) for pattern in patterns)


def build_thinking_suppression(
    provider: str,
    model: str,
    disable_thinking: bool = True,
) -> Dict[str, Any]:
    """Return request parameters for thinking control, or an empty dict."""
    if not model:
        return {}

    model_lower = model.strip().lower()
    provider_lower = provider.strip().lower() if provider else ""

    if _matches(EXCLUDE_PATTERNS, model_lower):
        return {}

    if provider_lower == "ollama":
        if _matches(OLLAMA_NATIVE_EXCLUDE_PATTERNS, model_lower):
            return {}
        if _matches(OLLAMA_NATIVE_RULES["supported_patterns"], model_lower):
            value = (
                OLLAMA_NATIVE_RULES["disable_value"]
                if disable_thinking
                else OLLAMA_NATIVE_RULES["enable_value"]
            )
            return {OLLAMA_NATIVE_RULES["parameter_name"]: value}
        return {}

    if not disable_thinking:
        return {}

    for rule in THINKING_CONTROL_RULES:
        if _matches(rule["patterns"], model_lower):
            return deepcopy(rule["params"])

    return {}


def should_append_no_thinking_instruction(
    provider: str,
    model: str,
    disable_thinking: bool = True,
) -> bool:
    if not disable_thinking or not model:
        return False

    provider_lower = provider.strip().lower() if provider else ""
    model_lower = model.strip().lower()

    if provider_lower == "ollama" and _matches(OLLAMA_NATIVE_EXCLUDE_PATTERNS, model_lower):
        return False

    return True


def get_rule_info(provider: str, model: str) -> Dict[str, Any]:
    """Return matching rule details for diagnostics."""
    if not model:
        return {"matched": False}

    model_lower = model.strip().lower()
    provider_lower = provider.strip().lower() if provider else ""

    if _matches(EXCLUDE_PATTERNS, model_lower):
        return {
            "matched": True,
            "rule_name": "excluded",
            "description": "Known model family without a reliable disable parameter",
            "params": {},
            "sources": [],
        }

    if provider_lower == "ollama":
        if _matches(OLLAMA_NATIVE_EXCLUDE_PATTERNS, model_lower):
            return {
                "matched": True,
                "rule_name": "ollama_native_excluded",
                "description": "Community model variant without reliable native thinking control",
                "params": {},
                "sources": [],
            }
        if _matches(OLLAMA_NATIVE_RULES["supported_patterns"], model_lower):
            return {
                "matched": True,
                "rule_name": "ollama_native",
                "description": "Ollama native /api/chat thinking control",
                "params": {OLLAMA_NATIVE_RULES["parameter_name"]: OLLAMA_NATIVE_RULES["disable_value"]},
                "sources": OLLAMA_NATIVE_RULES["sources"],
            }
        return {"matched": False}

    for rule in THINKING_CONTROL_RULES:
        if _matches(rule["patterns"], model_lower):
            return {
                "matched": True,
                "rule_name": rule["name"],
                "description": rule["description"],
                "params": deepcopy(rule["params"]),
                "sources": rule.get("sources", []),
            }

    return {"matched": False}
