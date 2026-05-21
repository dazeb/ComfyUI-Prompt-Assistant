"""
LLM Service - Refactored Version
Provides large language model expansion and translation functionality
Inherits OpenAICompatibleService to reuse common logic
"""

import time
import asyncio
from typing import Optional, Dict, Any, List, Callable
from .openai_base import OpenAICompatibleService
from .thinking_filter import postprocess_model_output
from ..utils.common import (
    format_api_error, ProgressBar, log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time,
    TASK_EXPAND, TASK_TRANSLATE
)
from .thinking_control import build_thinking_suppression, should_append_no_thinking_instruction


class LLMService(OpenAICompatibleService):
    """
    Large Language Model Service
    Supports prompt expansion and text translation
    """
    
    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """Get LLM configuration"""
        from ..config_manager import config_manager
        config = config_manager.get_llm_config()
        current_provider = config.get('provider')

        if 'providers' in config and current_provider in config['providers']:
            provider_config = config['providers'][current_provider]
            return {
                'provider': current_provider,
                'model': provider_config.get('model', ''),
                'base_url': provider_config.get('base_url', ''),
                'api_key': provider_config.get('api_key', ''),
                'temperature': provider_config.get('temperature', 0.7),
                'top_p': provider_config.get('top_p', 0.9),
                'max_tokens': provider_config.get('max_tokens', 2000),
                'auto_unload': provider_config.get('auto_unload', True)
            }
        else:
            return config
    
    @staticmethod
    def _is_chinese(text: str) -> bool:
        """Check if text contains Chinese characters"""
        return any('\u4e00' <= char <= '\u9fff' for char in text)
    
    @staticmethod
    async def _call_ollama_native(
        model: str,
        messages: List[Dict[str, str]],
        temperature: float,
        top_p: float,
        max_tokens: int,
        base_url: str,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        provider_display_name: str = "Ollama",
        auto_unload: bool = True,
        enable_advanced_params: bool = False,
        thinking_extra: Optional[Dict[str, Any]] = None,
        filter_thinking_output: bool = True,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None
    ) -> Dict[str, Any]:
        """
        Call Ollama native API (supports streaming output)
        Used for intelligent context window and thinking chain control
        
        Args:
            enable_advanced_params: Whether to send advanced parameters (temperature/top_p/num_predict)
            thinking_extra: Thinking chain control parameters
        """
        # ---Initialize request parameters---
        
        try:
            start_time = time.perf_counter()
            _thinking_extra = thinking_extra  # Use the passed parameter
            _thinking_tag = "(Thinking disabled)" if _thinking_extra else ""
            
            # Calculate base URL (ensure removal of /v1 and trailing slash)
            native_base = base_url.rstrip('/') if base_url else 'http://localhost:11434'
            if native_base.endswith('/v1'):
                native_base = native_base[:-3].rstrip('/')
            
            # Smart dynamic context window calculation (Token estimation strategy: Chinese 0.7/char, English 0.3/char -> conservative 0.6/char)
            # Safely calculate input length (includes System Prompt and User Prompt, assuming both are in messages)
            input_char_len = 0
            for msg in messages:
                input_char_len += len(msg.get('content', '') or '')
            
            estimated_input_tokens = int(input_char_len * 0.6)
            
            # --- Smart reservation strategy ---
            # Key point: Thinking process also consumes Output Token quota
            # 1. If thinking chain is successfully disabled (_thinking_extra is not empty) -> Safe
            # 2. If model name explicitly contains instruct/chat (usually no thinking process) -> Safe
            # 3. Other unknown models -> Assume thinking process may exist, reserve more space
            
            is_safe_standard_model = False
            if model:
                m = model.lower()
                if "instruct" in m or "chat" in m:
                    is_safe_standard_model = True

            if _thinking_extra or is_safe_standard_model: 
                # Thinking disabled OR standard instruction model -> Minimal mode
                min_output = 512
                min_ctx = 1024
            else:
                # Unknown/potential thinking model -> Safety mode (reserve space for thinking process)
                min_output = 1024
                min_ctx = 2048
            
            # Task type reservation
            output_reserve = max(min_output, int(estimated_input_tokens * 1.5))
            
            # 384 is the system overhead buffer (System Prompt is usually already in estimated_input_tokens, this is an extra safety margin)
            required_ctx = estimated_input_tokens + output_reserve + 384
            
            # Align to multiples of 1024
            # Limit to [min_ctx, 32768] range
            num_ctx = max(min_ctx, min(32768, required_ctx))
            num_ctx = ((num_ctx + 1023) // 1024) * 1024
            
            # Merge multiple System Messages (Ollama handles multiple system messages poorly)
            merged_messages = LLMService._merge_system_prompts(messages)
            
            # Build request (safely construct messages list)
            ollama_messages = []
            for msg in merged_messages:
                ollama_messages.append({
                    "role": msg.get('role', 'user'),
                    "content": msg.get('content', '')
                })
            
            # Build base request body
            payload = {
                "model": model,
                "messages": ollama_messages,
                "stream": True
            }
            
            # ---Build options---
            # Base parameter: num_ctx (dynamic context window size)
            options = {
                "num_ctx": num_ctx
            }
            
            # Advanced parameters: only sent when user enables them
            # Parameter description (based on Ollama official docs):
            # - temperature: Controls randomness, default 0.8, lower values produce more stable output
            # - top_p: Nucleus sampling, default 0.9, limits candidate word probability range
            # - num_predict: Maximum generation tokens, default -1 (unlimited)
            if enable_advanced_params:
                options["temperature"] = temperature
                options["top_p"] = top_p
                options["num_predict"] = max_tokens
            
            payload["options"] = options
            
            # Add thinking chain control parameters (e.g., think: true or think: false)
            if _thinking_extra:
                payload.update(_thinking_extra)
            
            from ..server import is_streaming_progress_enabled
            
            # Dynamic timeout calculation: base 30s + estimated 5s per 1000 tokens
            estimated_timeout = 30.0 + (num_ctx / 1000) * 5.0
            final_timeout = min(600.0, max(60.0, estimated_timeout)) # Limit between 60s - 600s
            
            # Create unified progress bar (automatically handles wait -> generate -> complete lifecycle)
            extra_info = f"Context:{num_ctx} | Timeout:{int(final_timeout)}s"
            pbar = ProgressBar(
                request_id=request_id,
                service_name=provider_display_name,
                extra_info=extra_info,
                streaming=is_streaming_progress_enabled(),
                task_type=task_type,
                source=source
            )
            
            start_time = time.perf_counter()
            
            try:
                from .ollama_native import OllamaNativeAdapter
                return await OllamaNativeAdapter.stream_chat(
                    model=model,
                    native_base=native_base,
                    payload=payload,
                    timeout=final_timeout,
                    pbar=pbar,
                    stream_callback=stream_callback,
                    cancel_event=cancel_event,
                    provider_label="Ollama",
                    include_reasoning=not filter_thinking_output,
                )
            finally:
                if auto_unload:
                    try:
                        await cls._unload_ollama_model(model, {"base_url": native_base, "auto_unload": True})
                    except:
                        pass
        
        # Key fix: Separately catch outer CancelledError to ensure pbar is stopped correctly
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} Task externally cancelled | Service:Ollama")
            return {"success": False, "error": "Task was cancelled", "interrupted": True}
        
        except Exception as e:
            # Key fix: Ensure pbar is stopped correctly on exception
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, provider_display_name))
            return {"success": False, "error": format_api_error(e, provider_display_name)}
    
    @staticmethod
    async def expand_prompt(
        prompt: str,
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        system_message_override: Optional[Dict[str, str]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Expand prompt using large language model
        
        Args:
            prompt: The prompt to expand
            request_id: Request ID
            stream_callback: Streaming output callback
            custom_provider: Custom provider
            custom_provider_config: Custom configuration
            system_message_override: Override system prompt
        
        Returns:
            Dict: {"success": bool, "data": {"original": str, "expanded": str}, "error": str}
        """
        try:
            # Get configuration
            if custom_provider and custom_provider_config:
                provider = custom_provider
                api_key = custom_provider_config.get('api_key')
                model = custom_provider_config.get('model')
                temperature = custom_provider_config.get('temperature', 0.7)
                top_p = custom_provider_config.get('top_p', 0.9)
                max_tokens = custom_provider_config.get('max_tokens', 2000)
                base_url = custom_provider_config.get('base_url', '')
            else:
                config = LLMService._get_config()
                provider = config.get('provider', 'unknown')
                api_key = config.get('api_key')
                model = config.get('model')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)
                base_url = config.get('base_url', '')

            # Note: empty API Key is allowed, supports unauthenticated providers (e.g., deepinfra public endpoints)
            if not model:
                return {"success": False, "error": "Model name not configured"}

            provider_display_name = LLMService.get_provider_display_name(provider)
            


            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # Get system prompt
            if system_message_override and system_message_override.get('content'):
                system_message = system_message_override
                prompt_name = system_message.get('name', 'Node custom rule')
            else:
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()

                if not system_prompts or 'expand_prompts' not in system_prompts:
                    return {"success": False, "error": "Failed to load prompt optimization system prompt"}

                active_prompt_id = system_prompts.get('active_prompts', {}).get('expand', 'expand_default')
                if active_prompt_id not in system_prompts['expand_prompts']:
                    if len(system_prompts['expand_prompts']) > 0:
                        active_prompt_id = list(system_prompts['expand_prompts'].keys())[0]
                    else:
                        return {"success": False, "error": "No available prompt optimization system prompt found"}

                system_message = system_prompts['expand_prompts'][active_prompt_id]
                prompt_name = system_message.get('name', active_prompt_id)
            
            # Check the disable_thinking parameter in service configuration, only disable thinking when enabled
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            # Always call build_thinking_suppression, passing the disable_thinking parameter
            _thinking_extra = build_thinking_suppression(service.get('type', provider) if service else provider, model, disable_thinking=disable_thinking_enabled)
            thinking_disabled = _thinking_extra is not None and disable_thinking_enabled
            model_display = format_model_with_thinking(model, thinking_disabled)

            # Build messages
            lang_content = "Please answer in Chinese." if LLMService._is_chinese(prompt) else "Please answer in English."
            provider_type = service.get('type', provider) if service else provider
            if should_append_no_thinking_instruction(provider_type, model, disable_thinking_enabled):
                lang_content += " Please output the result directly without any thinking process, reasoning process, or <think> tags."
            
            lang_message = {
                "role": "system",
                "content": lang_content
            }
            messages = [lang_message, system_message, {"role": "user", "content": prompt}]

            # Determine whether to use native Ollama API: must be ollama type, and base_url must not end with /v1 or contain /v1/
            is_native_ollama = False
            if service and service.get('type') == 'ollama':
                # Compatible with "http://xxx:11434/v1/" or "http://xxx:11434/v1"
                _url = base_url.rstrip('/')
                if not _url.endswith('/v1') and '/v1/' not in base_url:
                    is_native_ollama = True

            # Ollama uses native API
            if is_native_ollama:
                # Read Ollama service configuration
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
                
                # Calculate native_base uniformly (ensure /v1 and trailing slash are removed)
                native_base = base_url.rstrip('/')
                if native_base.endswith('/v1'):
                    native_base = native_base[:-3].rstrip('/')
                
                # Final fallback
                if not native_base:
                    native_base = 'http://localhost:11434'

                # Pre-calculate auto_unload configuration
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await LLMService._call_ollama_native(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    provider_display_name=provider_display_name,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_thinking_extra,
                    filter_thinking_output=effective_filter_thinking_output,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_EXPAND,
                    source=source
                )
                
                if result["success"]:
                    success, content = postprocess_model_output(
                        result["content"],
                        filter_thinking_output=effective_filter_thinking_output,
                    )
                    
                    # Final check if content is empty
                    if not success:
                        return {"success": False, "error": "API returned empty result after filtering reasoning content (Ollama native)"}
                    
                    return {
                        "success": True,
                        "data": {"original": prompt, "expanded": content}
                    }
                else:
                    return result

            # Other services use HTTP direct connection
            if not base_url:
                base_url = LLMService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # Check disable_thinking, enable_advanced_params and filter_thinking_output configuration
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await LLMService._http_request_chat_completions(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                thinking_extra=thinking_extra,
                enable_advanced_params=enable_advanced_params,
                stream_callback=stream_callback,
                request_id=request_id,
                provider_display_name=provider_display_name,
                cancel_event=cancel_event,
                task_type=task_type or TASK_EXPAND,
                source=source,
                filter_thinking_output=effective_filter_thinking_output
            )

            if result["success"]:
                success, content = postprocess_model_output(
                    result["content"],
                    filter_thinking_output=effective_filter_thinking_output,
                )
                
                # Final check if content is empty
                if not success:
                    return {"success": False, "error": "API returned empty result after filtering reasoning content (Model only output thinking process)"}
                return {
                    "success": True,
                    "data": {"original": prompt, "expanded": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "LLM Service")}
    
    @staticmethod
    async def translate(
        text: str,
        from_lang: str = 'auto',
        to_lang: str = 'zh',
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Translate text using large language model

        Args:
            text: The text to translate
            from_lang: Source language
            to_lang: Target language
            request_id: Request ID
            stream_callback: Streaming output callback
            custom_provider: Custom provider
            custom_provider_config: Custom configuration

        Returns:
            Dict: {"success": bool, "data": {"original": str, "translated": str}, "error": str}
        """
        try:
            # Get configuration (translation uses dedicated translation service configuration)
            if custom_provider and custom_provider_config:
                provider = custom_provider
                api_key = custom_provider_config.get('api_key')
                model = custom_provider_config.get('model')
                temperature = custom_provider_config.get('temperature', 0.7)
                top_p = custom_provider_config.get('top_p', 0.9)
                max_tokens = custom_provider_config.get('max_tokens', 2000)
                base_url = custom_provider_config.get('base_url', '')
            else:
                # Use translation service configuration (instead of LLM configuration)
                from ..config_manager import config_manager
                config = config_manager.get_translate_config()
                provider = config.get('provider', 'unknown')
                api_key = config.get('api_key')
                model = config.get('model')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)
                base_url = config.get('base_url', '')

            # Note: empty API Key allowed, supports unauthenticated providers
            if not model:
                return {"success": False, "error": "Model name not configured"}

            provider_display_name = LLMService.get_provider_display_name(provider)

            from ..config_manager import config_manager
            service = config_manager.get_service(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # Check if thinking chain is disabled
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            _thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_extra is not None and disable_thinking_enabled
            model_display = format_model_with_thinking(model, thinking_disabled)

            # Correct fix (BUG-06): Read user-defined translation prompts from the rule manager
            # translate_prompts configuration contains {src_lang}/{dst_lang} placeholders, dynamically replaced at runtime
            # Map language codes to natural language names to improve model understanding stability
            _LANG_NAMES = {
                "zh": "Simplified Chinese (简体中文)",
                "zh-tw": "Traditional Chinese (繁體中文)",
                "en": "English",
                "ja": "Japanese (日本語)",
                "ko": "Korean (한국어)",
                "fr": "French",
                "de": "German",
                "es": "Spanish",
                "ru": "Russian",
                "ar": "Arabic",
                "pt": "Portuguese",
                "pt-br": "Brazilian Portuguese",
                "it": "Italian",
                "tr": "Turkish",
                "fa": "Persian (Farsi)",
                "auto": "the detected source language"
            }
            from_name = _LANG_NAMES.get(from_lang.lower(), from_lang)
            to_name = _LANG_NAMES.get(to_lang.lower(), to_lang)

            translate_instruction = None
            try:
                system_prompts_data = config_manager.get_system_prompts()
                translate_prompts = system_prompts_data.get("translate_prompts", {})
                # Read active translation rules (currently only ZH, expandable later)
                active_prompts = system_prompts_data.get("active_prompts", {})
                active_translate_id = active_prompts.get("translate", "ZH")
                prompt_entry = translate_prompts.get(active_translate_id)
                # If active rule doesn't exist, fallback to first available rule
                if not prompt_entry and translate_prompts:
                    prompt_entry = next(iter(translate_prompts.values()))
                if prompt_entry and prompt_entry.get("content"):
                    # Replace {src_lang} / {dst_lang} placeholders with natural language names
                    translate_instruction = (
                        prompt_entry["content"]
                        .replace("{src_lang}", from_name)
                        .replace("{dst_lang}", to_name)
                    )
            except Exception as e:
                print(f"\n[PA] Failed to read translation rules, using default prompt: {e}", flush=True)

            # Ultimate fallback: use English simplified instruction when rule manager reading fails
            if not translate_instruction:
                translate_instruction = (
                    f"Translate the following text from {from_name} to {to_name}. "
                    f"Output only the translation result with no explanations or additional content."
                )

            messages = [
                {"role": "system", "content": translate_instruction},
                {"role": "user", "content": text}
            ]


            # Determine whether to use native Ollama API: must be ollama type, and base_url must not end with /v1 or contain /v1/
            is_native_ollama = False
            if service and service.get('type') == 'ollama':
                # Compatible with "http://xxx:11434/v1/" or "http://xxx:11434/v1"
                _url = base_url.rstrip('/')
                if not _url.endswith('/v1') and '/v1/' not in base_url:
                    is_native_ollama = True

            # Ollama uses native API
            if is_native_ollama:
                # Read Ollama service configuration
                disable_thinking_enabled = service.get('disable_thinking', True)
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
                _ollama_thinking_extra = build_thinking_suppression(service.get('type', provider) if service else provider, model) if disable_thinking_enabled else None
                
                # Calculate native_base uniformly (ensure /v1 and trailing slash are removed)
                native_base = base_url.rstrip('/')
                if native_base.endswith('/v1'):
                    native_base = native_base[:-3].rstrip('/')
                
                # Final fallback
                if not native_base:
                    native_base = 'http://localhost:11434'

                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await LLMService._call_ollama_native(
                    model=model,
                    messages=[{"role": "system", "content": translate_instruction}, {"role": "user", "content": text}],
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    provider_display_name=provider_display_name,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    filter_thinking_output=effective_filter_thinking_output,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_TRANSLATE,
                    source=source
                )
                
                if result["success"]:
                    success, content = postprocess_model_output(
                        result["content"],
                        filter_thinking_output=effective_filter_thinking_output,
                    )
                    
                    # Final check
                    if not success:
                        return {"success": False, "error": "API returned empty result after filtering reasoning content (Ollama native)"}
                    
                    return {
                        "success": True,
                        "data": {"original": text, "translated": content}
                    }
                else:
                    return result

            # Other services use HTTP direct connection
            if not base_url:
                base_url = LLMService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # Check enable_advanced_params and filter_thinking_output configuration
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
            thinking_extra = _thinking_extra # Reuse previously computed suppression
            
            result = await LLMService._http_request_chat_completions(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=messages,
                temperature=temperature,
                top_p=top_p,
                max_tokens=max_tokens,
                thinking_extra=thinking_extra,
                enable_advanced_params=enable_advanced_params,
                stream_callback=stream_callback,
                request_id=request_id,
                provider_display_name=provider_display_name,
                cancel_event=cancel_event,
                task_type=task_type or TASK_TRANSLATE,
                source=source,
                filter_thinking_output=effective_filter_thinking_output
            )

            if result["success"]:
                success, content = postprocess_model_output(
                    result["content"],
                    filter_thinking_output=effective_filter_thinking_output,
                )
                
                # Final check
                if not success:
                    return {"success": False, "error": "API returned empty result after filtering reasoning content"}
                return {
                    "success": True,
                    "data": {"original": text, "translated": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "LLM Service")}
