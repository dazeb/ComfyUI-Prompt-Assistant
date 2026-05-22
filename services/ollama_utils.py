import asyncio
import re
from typing import Any, Dict, Tuple


OLLAMA_AUTO_UNLOAD_DELAY_SECONDS = 1.0
OLLAMA_NATIVE_THINKING_UNRELIABLE_PATTERNS = [
    r"abliterated",
    r"uncensored",
]

FINAL_ANSWER_MARKERS = [
    r"最终答案\s*[:：]",
    r"最终输出\s*[:：]",
    r"最终结果\s*[:：]",
    r"最后输出\s*[:：]",
    r"答案\s*[:：]",
    r"final\s+answer\s*[:：]",
    r"final\s+result\s*[:：]",
]

THINKING_META_TERMS = [
    "用户",
    "请求",
    "要求",
    "需要",
    "应该",
    "决定",
    "思考",
    "推理",
    "只输出",
    "最终结果",
    "最终答案",
    "最终输出",
    "reason",
    "analysis",
]


def is_ollama_thinking_unreliable_model(model: str) -> bool:
    model_lower = (model or "").strip().lower()
    return any(re.search(pattern, model_lower) for pattern in OLLAMA_NATIVE_THINKING_UNRELIABLE_PATTERNS)


def collect_ollama_message_parts(message: Dict[str, Any]) -> Tuple[str, str]:
    """Return visible content and hidden reasoning from an Ollama chat message."""
    if not isinstance(message, dict):
        return "", ""

    content = message.get("content") or ""
    reasoning = (
        message.get("thinking")
        or message.get("reasoning")
        or message.get("reasoning_content")
        or ""
    )
    return str(content), str(reasoning)


def _cleanup_extracted_answer(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"</?(think|thinking|reasoning|thoughts?)>", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" \t\r\n\"'“”‘’`")
    return cleaned.strip()


def _looks_like_meta_reasoning(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return True
    return any(term in normalized for term in THINKING_META_TERMS)


def _extract_quoted_answer(text: str) -> str:
    quoted_candidates = re.findall(r"[\"“”‘']([^\"“”‘']{6,500})[\"“”‘']", text or "")
    for candidate in reversed(quoted_candidates):
        candidate = _cleanup_extracted_answer(candidate)
        if candidate and not _looks_like_meta_reasoning(candidate):
            return candidate
    return ""


def extract_final_answer_from_reasoning(reasoning: str) -> str:
    reasoning = (reasoning or "").strip()
    if not reasoning:
        return ""

    quoted_answer = _extract_quoted_answer(reasoning)

    for marker in FINAL_ANSWER_MARKERS:
        matches = list(re.finditer(marker, reasoning, flags=re.IGNORECASE))
        if not matches:
            continue
        candidate = reasoning[matches[-1].end():].strip()
        candidate = re.split(r"\n\s*\n", candidate, maxsplit=1)[0]
        nested_candidate = _extract_quoted_answer(candidate)
        if nested_candidate:
            return nested_candidate
        candidate = _cleanup_extracted_answer(candidate)
        if candidate and not _looks_like_meta_reasoning(candidate):
            return candidate

    if quoted_answer:
        return quoted_answer

    return ""


def describe_ollama_empty_content(content: str, reasoning: str) -> str:
    if reasoning and not (content or "").strip():
        return "Ollama model only returned reasoning content without a final answer"
    return "Ollama model returned empty content"


def finalize_ollama_content(
    content: str,
    reasoning: str,
    *,
    include_reasoning: bool = False,
) -> Tuple[bool, str]:
    content = (content or "").strip()
    reasoning = (reasoning or "").strip()
    if include_reasoning and reasoning:
        visible = f"<think>{reasoning}</think>"
        if content:
            visible = f"{visible}\n{content}"
        return True, visible
    if content:
        return True, content
    extracted_answer = extract_final_answer_from_reasoning(reasoning)
    if extracted_answer:
        return True, extracted_answer
    return False, ""


def should_retry_without_ollama_think(payload: Dict[str, Any], result: Dict[str, Any]) -> bool:
    if "think" not in payload or result.get("success"):
        return False

    error_text = str(result.get("error", "")).lower()
    return (
        "think" in error_text
        or "support" in error_text
        or "invalid" in error_text
        or "unknown field" in error_text
        or "unsupported" in error_text
    )


def is_ollama_reasoning_only_response(result: Dict[str, Any]) -> bool:
    if result.get("success"):
        return False
    if result.get("reasoning"):
        return True
    return "only returned reasoning content" in str(result.get("error", "")).lower()


def build_ollama_final_answer_retry_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    retry_payload = payload.copy()
    model = str(retry_payload.get("model") or "")
    use_soft_retry = is_ollama_thinking_unreliable_model(model)

    if use_soft_retry:
        retry_payload.pop("think", None)
    else:
        retry_payload["think"] = False

    options = dict(retry_payload.get("options") or {})
    if use_soft_retry:
        try:
            current_num_predict = int(options.get("num_predict", 512))
        except (TypeError, ValueError):
            current_num_predict = 512
        options["num_predict"] = min(max(current_num_predict, 512), 768)
    else:
        if "num_predict" in options:
            try:
                options["num_predict"] = max(int(options["num_predict"]), 2048)
            except (TypeError, ValueError):
                options["num_predict"] = 2048
    retry_payload["options"] = options

    if use_soft_retry:
        instruction = "请继续完成原始请求，只输出可以直接使用的最终结果。"
    else:
        instruction = (
            "Your previous response contained only internal reasoning and no final answer. "
            "Now output only the final result for the original request. "
            "Do not include reasoning, analysis, explanations, markdown fences, or <think> tags."
        )
    messages = [dict(message) for message in (retry_payload.get("messages") or [])]

    image_message_index = None
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("images"):
            image_message_index = index
            break

    if image_message_index is not None:
        content = messages[image_message_index].get("content") or ""
        messages[image_message_index]["content"] = f"{content}\n\n{instruction}".strip()
    else:
        messages.append({
            "role": "user",
            "content": instruction,
        })
    retry_payload["messages"] = messages
    return retry_payload


async def wait_before_ollama_unload(
    delay_seconds: float = OLLAMA_AUTO_UNLOAD_DELAY_SECONDS,
) -> None:
    if delay_seconds > 0:
        await asyncio.sleep(delay_seconds)
