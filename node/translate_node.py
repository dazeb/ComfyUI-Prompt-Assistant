"""
Prompt Translation Node - V3 Version

V3 migration notes:
    - Inherits LLMNodeBase (tool mixin) + io.ComfyNode (V3 node base)
    - INPUT_TYPES → define_schema(), returns io.Schema
    - IS_CHANGED → fingerprint_inputs()
    - def translate(self, ...) → @classmethod execute(cls, ...)
    - All helper instance methods converted to @classmethod
    - Returns io.NodeOutput(val) instead of (val,)
    - hidden unique_id accessed via cls.hidden.unique_id
    - No longer exports NODE_CLASS_MAPPINGS, registered by ComfyExtension in top-level __init__.py
"""

import hashlib
import re

from comfy.model_management import InterruptProcessingException
from comfy_api.latest import io

from ..services.llm import LLMService
from ..services.baidu import BaiduTranslateService
from ..utils.common import (
    format_api_error, format_model_with_thinking, generate_request_id,
    log_prepare, log_error, TASK_TRANSLATE, SOURCE_NODE
)
from ..services.thinking_control import build_thinking_suppression
from .base import LLMNodeBase


class PromptTranslate(LLMNodeBase, io.ComfyNode):
    """
    Prompt translation node (V3)
    Auto-detects input language and translates to target language, supports multiple translation services
    """

    @classmethod
    def define_schema(cls):
        """Define node Schema (V3 replacement for INPUT_TYPES + class attributes)"""
        # ---Dynamically fetch translation service/model list (includes hardcoded Baidu Translate)---
        service_options = cls.get_translate_service_options()
        default_service = service_options[0] if service_options else "Baidu Translate"

        return io.Schema(
            node_id="PromptTranslate",
            display_name="✨Prompt Translate",
            category="✨Prompt Assistant",
            description="Auto-detect input language and translate to target language",
            inputs=[
                io.String.Input(
                    "source_text",
                    force_input=True,
                    default="",
                    multiline=True,
                    placeholder="Input text to translate...",
                    tooltip="Text to translate",
                ),
                io.Combo.Input(
                    "target_language",
                    options=["English", "Chinese"],
                    default="English",
                ),
                io.Combo.Input(
                    "translate_service",
                    options=service_options,
                    default=default_service,
                    tooltip="Select translation service and model",
                ),
                # Ollama auto VRAM unload
                io.Boolean.Input(
                    "ollama_auto_unload",
                    default=True,
                    label_on="Enable",
                    label_off="Disable",
                    tooltip="Auto unload Ollama model after generation",
                ),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xffffffffffffffff,
                    control_after_generate=True,
                ),
            ],
            outputs=[
                io.String.Output("translated_text"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        source_text=None, target_language=None, translate_service=None,
        ollama_auto_unload=None, seed=None
    ):
        """
        Replaces V1 IS_CHANGED, only triggers re-execution when input content actually changes
        Uses hash of input parameters as the basis for comparison
        """
        text_hash = ""
        if source_text:
            text_hash = hashlib.md5(source_text.encode('utf-8')).hexdigest()

        input_hash = hash((
            text_hash,
            target_language,
            translate_service,
            bool(ollama_auto_unload),
            seed
        ))
        return input_hash

    @classmethod
    def _contains_chinese(cls, text: str) -> bool:
        """Check if text contains Chinese characters"""
        if not text:
            return False
        return bool(re.search('[\u4e00-\u9fa5]', text))

    @classmethod
    def _detect_language(cls, text: str) -> str:
        """Auto-detect text language"""
        if not text:
            return "auto"

        # Check if pure English (only ASCII printable characters)
        is_pure_english = bool(re.fullmatch(r'[ -~]+', text))
        # Check if contains Chinese characters
        contains_chinese = cls._contains_chinese(text)

        if contains_chinese:
            return "zh"
        elif is_pure_english:
            return "en"
        else:
            return "auto"

    @classmethod
    def _translate_with_baidu(cls, text, from_lang, to_lang, service_name, from_lang_name, to_lang_name, unique_id):
        """Use Baidu translate service"""
        # Create request ID
        request_id = generate_request_id("trans", "baidu", unique_id)

        # Prepare phase log
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, "Baidu Translate", None, None, {"direction": f"{from_lang_name}→{to_lang_name}", "length": len(text)})

        # Execute translation (async thread + interruptible)
        result = cls._run_llm_task(
            BaiduTranslateService.translate,
            service_name,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )
        return request_id, result

    @classmethod
    def _translate_with_llm(cls, text, from_lang, to_lang, service_id, model_name, service, service_display_name, from_lang_name, to_lang_name, auto_unload, unique_id):
        """Use LLM translation service"""
        # ---Build provider_config---
        llm_models = service.get('llm_models', [])
        target_model = None

        if model_name:
            target_model = next((m for m in llm_models if m.get('name') == model_name), None)

        if not target_model:
            target_model = next(
                (m for m in llm_models if m.get('is_default')),
                llm_models[0] if llm_models else None
            )

        if not target_model:
            return None, {"success": False, "error": f"Service {service_display_name} has no available models"}

        provider_config = {
            'provider': service_id,
            'model': target_model.get('name', ''),
            'base_url': service.get('base_url', ''),
            'api_key': service.get('api_key', ''),
            'temperature': target_model.get('temperature', 0.7),
            'max_tokens': target_model.get('max_tokens', 1000),
            'top_p': target_model.get('top_p', 0.9),
        }

        # Ollama special handling: add auto_unload config
        if service.get('type') == 'ollama':
            provider_config['auto_unload'] = auto_unload

        # Create request ID
        request_id = generate_request_id("trans", "llm", unique_id)

        # Check if thinking chain is disabled
        model_full_name = provider_config.get('model')
        disable_thinking_enabled = service.get('disable_thinking', True)
        thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
        model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))

        # Get service display name
        service_display_name = service.get('name', service_id)

        # Prepare phase log
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_NODE, service_display_name, model_display, None, {"direction": f"{from_lang_name}→{to_lang_name}", "length": len(text)})

        # Check API key and model
        api_key = provider_config.get('api_key', '')
        model = provider_config.get('model', '')

        if not model:
            return request_id, {"success": False, "error": f"Please configure model for {service_display_name}"}
        if cls._service_requires_api_key(service) and not api_key:
            return request_id, {"success": False, "error": f"Please configure API key and model for {service_display_name}"}

        # Execute translation (async thread + interruptible)
        result = cls._run_llm_task(
            LLMService.translate,
            service_id,
            text=text,
            from_lang=from_lang,
            to_lang=to_lang,
            request_id=request_id,
            stream_callback=None,
            custom_provider=service_id,
            custom_provider_config=provider_config,
            task_type=TASK_TRANSLATE,
            source=SOURCE_NODE
        )
        return request_id, result

    @classmethod
    def execute(cls, source_text, target_language, translate_service, ollama_auto_unload, seed=None):
        """
        Translate text function (V3 classmethod version)
        Accesses node unique ID via cls.hidden.unique_id
        """
        # Get node unique ID from cls.hidden
        unique_id = cls.hidden.unique_id
        request_id = None

        try:
            # Check input
            if not source_text or not source_text.strip():
                return io.NodeOutput("")

            # Auto-detect source language
            detected_lang = cls._detect_language(source_text)
            to_lang = "en" if target_language == "English" else "zh"

            # Smart skip translation logic
            skip_translation = False
            if to_lang == 'en' and detected_lang == 'en':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{cls.REQUEST_PREFIX} English input detected, target is English, no translation needed", flush=True)
                skip_translation = True
            elif to_lang == 'zh' and detected_lang == 'zh':
                from ..utils.common import _ANSI_CLEAR_EOL
                print(f"\r{_ANSI_CLEAR_EOL}{cls.REQUEST_PREFIX} Chinese input detected, target is Chinese, no translation needed", flush=True)
                skip_translation = True

            if skip_translation:
                return io.NodeOutput(source_text)

            # Map language names
            lang_map = {'zh': 'Chinese', 'en': 'English', 'auto': 'Source'}
            from_lang_name = lang_map.get(detected_lang, detected_lang)
            to_lang_name = lang_map.get(to_lang, to_lang)

            # ---Parse service/model string---
            service_id, model_name = cls.parse_service_model(translate_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {translate_service}")

            # ---Baidu Translate special handling---
            if service_id == 'baidu':
                request_id, result = cls._translate_with_baidu(
                    source_text, detected_lang, to_lang,
                    translate_service, from_lang_name, to_lang_name, unique_id
                )
            else:
                # ---LLM translation: get service config---
                from ..config_manager import config_manager
                service = config_manager.get_service(service_id)
                if not service:
                    raise ValueError(f"Service config not found: {translate_service}")

                request_id, result = cls._translate_with_llm(
                    source_text, detected_lang, to_lang,
                    service_id, model_name, service,
                    translate_service, from_lang_name, to_lang_name,
                    ollama_auto_unload, unique_id
                )

            if result and result.get('success'):
                translated_text = result.get('data', {}).get('translated', '').strip()
                if not translated_text:
                    error_msg = 'API returned empty result'
                    raise RuntimeError(f"❌Translation failed: {error_msg}")
                # Result phase log is output by service layer, node layer does not repeat
                return io.NodeOutput(translated_text)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                if error_msg == "Task interrupted":
                    raise InterruptProcessingException()
                log_error(TASK_TRANSLATE, request_id, error_msg)
                raise RuntimeError(f"Translation failed: {error_msg}")

        except InterruptProcessingException:
            # Don't print log, let base class handle it
            raise
        except Exception as e:
            error_msg = format_api_error(e, translate_service)
            log_error(TASK_TRANSLATE, request_id, error_msg)
            raise RuntimeError(f"Translation error: {error_msg}")
