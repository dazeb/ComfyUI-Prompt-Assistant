import re
from typing import Tuple


THINKING_TAG_PATTERN = r"<(think|thinking|reasoning|thoughts?)>[\s\S]*?</\1>"
ORPHAN_THINKING_END_PATTERN = r"^[\s\S]*?</(think|thinking|reasoning|thoughts?)>"
ORPHAN_THINKING_START_PATTERN = r"<(think|thinking|reasoning|thoughts?)>[\s\S]*$"


def filter_thinking_content(text: str) -> str:
    if not text:
        return text

    text = re.sub(THINKING_TAG_PATTERN, "", text, flags=re.IGNORECASE)
    text = re.sub(ORPHAN_THINKING_END_PATTERN, "", text, flags=re.IGNORECASE)
    text = re.sub(ORPHAN_THINKING_START_PATTERN, "", text, flags=re.IGNORECASE)
    return text.strip()


def postprocess_model_output(
    content: str,
    *,
    filter_thinking_output: bool = True,
) -> Tuple[bool, str]:
    content = content or ""
    if not filter_thinking_output:
        return bool(content.strip()), content.strip()

    filtered = filter_thinking_content(content)
    return bool(filtered.strip()), filtered
