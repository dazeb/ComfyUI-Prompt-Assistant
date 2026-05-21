"""
VLM Service - Refactored Version
Provides vision model image analysis functionality
Inherits OpenAICompatibleService to reuse common logic
"""

import time
import asyncio
from typing import Optional, Dict, Any, List, Callable
from .openai_base import OpenAICompatibleService
from .thinking_filter import postprocess_model_output
from ..utils.common import (
    format_api_error, preprocess_image, check_multi_image_support, ProgressBar,
    log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time,
    TASK_IMAGE_CAPTION, TASK_VIDEO_CAPTION
)
from .thinking_control import build_thinking_suppression, should_append_no_thinking_instruction


class VisionService(OpenAICompatibleService):
    """
    Vision model service
    Supports single and multi-image analysis
    """
    
    @staticmethod
    def _get_config() -> Dict[str, Any]:
        """Get vision model configuration"""
        from ..config_manager import config_manager
        config = config_manager.get_vision_config()
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
    async def _call_ollama_native_vision(
        model: str,
        system_prompt: str,
        images_b64: List[str],
        temperature: float,
        top_p: float,
        max_tokens: int,
        base_url: str,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        is_multi: bool = False,
        auto_unload: bool = True,
        enable_advanced_params: bool = False,
        thinking_extra: Optional[Dict[str, Any]] = None,
        filter_thinking_output: bool = True,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None
    ) -> Dict[str, Any]:
        """
        Call Ollama native vision API (/api/chat)
        Supports single and multi-image analysis

        Args:
            enable_advanced_params: Whether to send advanced parameters (temperature/top_p/num_predict)
            thinking_extra: Thinking chain control parameters
        """
        from ..server import is_streaming_progress_enabled
        
        try:
            start_time = time.perf_counter()
            
            _thinking_extra = thinking_extra  # Use the passed parameter
            _thinking_tag = "" if _thinking_extra else ""

            # Calculate base URL (ensure removal of /v1 and trailing slash)
            native_base = base_url.rstrip('/') if base_url else 'http://localhost:11434'
            if native_base.endswith('/v1'):
                native_base = native_base[:-3].rstrip('/')
            
            # Dynamic num_ctx calculation (based on image count)
            # Each image needs approximately 1024-2048 tokens
            img_count = len(images_b64)

            # Text token estimation (0.6 factor)
            prompt_ctx = int(len(system_prompt) * 0.6)

            # Image token estimation (2048 per image as baseline)
            image_ctx = img_count * 2048

            # --- Smart reservation strategy (adapted for Vision models) ---
            # Key point: Vision model's thinking process also uses a lot of Output Tokens
            
            is_safe_standard_model = False
            if model:
                m = model.lower()
                if "instruct" in m or "chat" in m:
                    is_safe_standard_model = True

            if _thinking_extra or is_safe_standard_model:
                # Thinking disabled OR standard instruction model -> Minimal mode
                min_output = 512
                # Single image can go down to 2048, multi-image keeps 3072 to ensure stability
                ctx_floor = 2048 if not is_multi else 3072
                sys_buffer = 384
            else:
                # Thinking not disabled -> Safety mode
                min_output = 1024
                # Single image floor reduced from 4096 to 2048 (adapted to Ollama VRAM allocation optimization)
                ctx_floor = 2048 if not is_multi else 4096
                sys_buffer = 384 if not is_multi else 1024

            # Output reservation (multi-image needs more)
            # For single image mode, 512 is enough for description; for multi-image, use min_output
            base_reserve = (img_count * 512) if is_multi else 512
            output_reserve = max(512 if not is_multi else min_output, base_reserve)
            
            required_ctx = prompt_ctx + image_ctx + output_reserve + sys_buffer

            # Range: [ctx_floor, 65536]
            num_ctx = max(ctx_floor, min(65536, required_ctx))
            num_ctx = ((num_ctx + 1023) // 1024) * 1024

            # [Debug] Output multi-image request info
            print(f"{PREFIX} Vision request | Image count:{len(images_b64)} | num_ctx:{num_ctx} | Model:{model}")

            # Build base request body
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": system_prompt, "images": images_b64}],
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

            # Set timeout
            # Base read timeout 60s + 30s per image + context length adaptation
            base_read_timeout = 60.0
            per_image_read_timeout = 30.0
            ctx_based_timeout = (num_ctx / 1000) * 2.0 # 2s per 1000 tokens

            calculated_read_timeout = base_read_timeout + (img_count * per_image_read_timeout) + ctx_based_timeout

            # Maximum read timeout cap at 10 minutes (600s)
            final_read_timeout = min(600.0, max(60.0, calculated_read_timeout))

            # Create unified progress bar (automatically handles wait -> generate -> complete lifecycle)
            extra_info = f"Context:{num_ctx} | Timeout:{int(final_read_timeout)}s"
            pbar = ProgressBar(
                request_id=request_id,
                service_name="Ollama",
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
                    timeout=final_read_timeout,
                    pbar=pbar,
                    stream_callback=stream_callback,
                    cancel_event=cancel_event,
                    provider_label="Ollama(Vision)",
                    include_reasoning=not filter_thinking_output,
                )
            finally:
                try:
                    from .llm import LLMService
                    await LLMService._unload_ollama_model(model, {"base_url": native_base, "auto_unload": auto_unload})
                except:
                    pass
        
        # Key fix: Separately catch outer CancelledError to ensure pbar is stopped correctly
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} Task externally cancelled | Service:Ollama(Vision)")
            return {"success": False, "error": "Task cancelled", "interrupted": True}

        except Exception as e:
            # Key fix: Ensure pbar is also stopped on exception
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, "Ollama"))
            return {"success": False, "error": format_api_error(e, "Ollama")}
    
    @staticmethod
    async def analyze_image(
        image_data: str,
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        prompt_content: Optional[str] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze a single image using the vision model

        Args:
            image_data: Image data (Base64 encoded)
            request_id: Request ID
            stream_callback: Streaming output callback
            prompt_content: Custom prompt
            custom_provider: Custom provider
            custom_provider_config: Custom configuration

        Returns:
            Dict: {"success": bool, "data": {"description": str}, "error": str}
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
                config = VisionService._get_config()
                provider = config.get('provider', 'unknown')
                api_key = config.get('api_key')
                model = config.get('model')
                temperature = config.get('temperature', 0.7)
                top_p = config.get('top_p', 0.9)
                max_tokens = config.get('max_tokens', 2000)
                base_url = config.get('base_url', '')

            # Note: empty API Key is allowed, supports unauthenticated providers
            if not model:
                return {"success": False, "error": "Model name not configured"}

            provider_display_name = VisionService.get_provider_display_name(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking

            # Check service configuration to determine whether to show thinking chain indicator
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            # Only show indicator when switch is enabled and model supports it
            _thinking_check = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_check is not None
            model_display = format_model_with_thinking(model, thinking_disabled)

            # Preprocess image
            processed_image = preprocess_image(image_data, request_id=request_id)

            # Get system prompt
            system_prompt = prompt_content or "Please describe the content of this image in detail, including main objects, scene, colors, atmosphere, etc."
            provider_type = service.get('type', provider) if service else provider
            if should_append_no_thinking_instruction(provider_type, model, disable_thinking_enabled):
                system_prompt += " Please output the result directly without any thinking process, reasoning process, or <think> tags."

            # Ollama native API: /v1 address keeps OpenAI-compatible path
            is_native_ollama = False
            if service and service.get('type') == 'ollama':
                _url = base_url.rstrip('/') if base_url else ''
                if not _url.endswith('/v1') and '/v1/' not in _url:
                    is_native_ollama = True

            if is_native_ollama:
                # Read Ollama service configuration
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
                _ollama_thinking_extra = build_thinking_suppression(service.get('type', provider), model) if disable_thinking_enabled else None

                # Extract pure base64
                b64 = processed_image.split(',')[1] if ',' in processed_image else processed_image

                # Pre-calculate auto_unload configuration
                native_base = base_url[:-3] if base_url and base_url.endswith('/v1') else (base_url or 'http://localhost:11434')
                native_base = native_base.rstrip('/')
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                result = await VisionService._call_ollama_native_vision(
                    model=model,
                    system_prompt=system_prompt,
                    images_b64=[b64],
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    is_multi=False,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    filter_thinking_output=effective_filter_thinking_output,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_IMAGE_CAPTION,
                    source=source
                )
                
                if result["success"]:
                    success, content = postprocess_model_output(
                        result["content"],
                        filter_thinking_output=effective_filter_thinking_output,
                    )
                    if not success:
                        return {"success": False, "error": "API returned empty result after filtering reasoning content (Model only output thinking process)"}
                    
                    return {
                        "success": True,
                        "data": {"description": content}
                    }
                else:
                    return result

            # Other services go through HTTP direct connection
            if not base_url:
                base_url = VisionService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)

            # Build messages (image format)
            # Key fix (BUG-01): system_prompt sent independently as system role
            # Strict providers like Zhipu GLM-4V require strict separation of system/user roles
            # user content array only contains short task trigger words and image URL
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": "Please analyze this image."},
                    {"type": "image_url", "image_url": {"url": processed_image}}
                ]
            })

            # Check disable_thinking, enable_advanced_params and filter_thinking_output configuration
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await VisionService._http_request_chat_completions(
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
                task_type=task_type or TASK_IMAGE_CAPTION,
                source=source,
                filter_thinking_output=effective_filter_thinking_output
            )

            if result["success"]:
                success, content = postprocess_model_output(
                    result["content"],
                    filter_thinking_output=effective_filter_thinking_output,
                )
                if not success:
                    return {"success": False, "error": "API returned empty result after filtering reasoning content (Model only output thinking process)"}
                return {
                    "success": True,
                    "data": {"description": content}
                }
            else:
                return result

        except Exception as e:
            return {"success": False, "error": format_api_error(e, "VLM Service")}
    
    @staticmethod
    async def analyze_images(
        images_data: List[str],
        request_id: Optional[str] = None,
        stream_callback: Optional[Callable[[str], None]] = None,
        prompt_content: Optional[str] = None,
        custom_provider: Optional[str] = None,
        custom_provider_config: Optional[Dict[str, Any]] = None,
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Analyze multiple images using the vision model

        Args:
            images_data: List of image data (Base64 encoded)
            request_id: Request ID
            stream_callback: Streaming output callback
            prompt_content: Custom prompt
            custom_provider: Custom provider
            custom_provider_config: Custom configuration

        Returns:
            Dict: {"success": bool, "data": {"description": str}, "error": str}
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
                config = VisionService._get_config()
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

            provider_display_name = VisionService.get_provider_display_name(provider)

            from ..utils.common import REQUEST_PREFIX, PREFIX, format_model_with_thinking
            
            # Check service configuration to determine if thinking chain indicator should be shown
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            # Only show indicator when switch is enabled and model supports it
            _thinking_check = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            thinking_disabled = _thinking_check is not None
            model_display = format_model_with_thinking(model, thinking_disabled)

            # Smart upper limit inference (truncated at node layer, silent handling as last defense at service layer)
            from ..utils.common import get_model_max_images
            max_images = get_model_max_images(model)
            if len(images_data) > max_images:
                images_data = images_data[:max_images]

            # Preprocess all images (smart compression: dynamically adjust quality based on image count)
            img_count = len(images_data)
            from ..utils.common import get_optimal_image_params
            _, _, compression_level = get_optimal_image_params(img_count)
            
            # Use ProgressBar to manage preprocessing progress
            pbar = ProgressBar(request_id=request_id, service_name="Image Preprocessing", streaming=False)
            processed_images = []
            for idx, img in enumerate(images_data, 1):
                processed = preprocess_image(img, request_id=request_id, silent=True, image_count=img_count)
                processed_images.append(processed)
            
            pbar.done(f"{PREFIX} 🟡 Preprocessing complete: {img_count}/{img_count} | Compression:{compression_level}")

            # Get system prompt
            system_prompt = prompt_content or "Please describe these images in detail, analyzing their relationships and differences."
            provider_type = service.get('type', provider) if service else provider
            if should_append_no_thinking_instruction(provider_type, model, disable_thinking_enabled):
                system_prompt += " Please output the result directly without any thinking process, reasoning process, or <think> tags."

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
                from ..config_manager import config_manager
                # Keep type checking here, no longer hardcoding ID 'ollama'
                disable_thinking_enabled = service.get('disable_thinking', True)
                enable_advanced_params = service.get('enable_advanced_params', False)
                filter_thinking_output = service.get('filter_thinking_output', True)
                effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
                _ollama_thinking_extra = build_thinking_suppression(service.get('type', provider), model) if disable_thinking_enabled else None
                
                # Pre-calculate auto_unload configuration
                native_base = base_url[:-3] if base_url.endswith('/v1') else (base_url or 'http://localhost:11434')
                native_base = native_base.rstrip('/')
                _cfg = {
                    'auto_unload': custom_provider_config.get('auto_unload', True) if custom_provider_config else config.get('auto_unload', True),
                    'base_url': native_base
                }
                auto_unload = _cfg['auto_unload']

                # Extract pure base64
                b64_images = [img.split(',')[1] if ',' in img else img for img in processed_images]
                
                result = await VisionService._call_ollama_native_vision(
                    model=model,
                    system_prompt=system_prompt,
                    images_b64=b64_images,
                    temperature=temperature,
                    top_p=top_p,
                    max_tokens=max_tokens,
                    base_url=base_url,
                    stream_callback=stream_callback,
                    request_id=request_id,
                    is_multi=True,
                    auto_unload=auto_unload,
                    enable_advanced_params=enable_advanced_params,
                    thinking_extra=_ollama_thinking_extra,
                    filter_thinking_output=effective_filter_thinking_output,
                    cancel_event=cancel_event,
                    task_type=task_type or TASK_VIDEO_CAPTION,
                    source=source
                )
                
                if result["success"]:
                    success, content = postprocess_model_output(
                        result["content"],
                        filter_thinking_output=effective_filter_thinking_output,
                    )
                    if not success:
                        return {"success": False, "error": "API returned empty result after filtering reasoning content (Model only output thinking process)"}
                    
                    return {
                        "success": True,
                        "data": {"description": content}
                    }
                else:
                    return result

            # Other services use HTTP direct connection
            if not base_url:
                base_url = VisionService.get_provider_base_url(provider, custom_provider_config if custom_provider else None)
            
            # Build multi-image messages
            # Key fix (BUG-01): system_prompt sent independently as system role
            # Multi-image user content array only contains brief instruction and all image URLs
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            
            multi_content = [{"type": "text", "text": "Please analyze these images."}]
            for img in processed_images:
                multi_content.append({"type": "image_url", "image_url": {"url": img}})
            messages.append({"role": "user", "content": multi_content})
            
            # Check disable_thinking, enable_advanced_params and filter_thinking_output configuration
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            enable_advanced_params = service.get('enable_advanced_params', False) if service else False
            filter_thinking_output = service.get('filter_thinking_output', True) if service else True
            effective_filter_thinking_output = filter_thinking_output or disable_thinking_enabled
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            
            result = await VisionService._http_request_chat_completions(
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
                task_type=task_type or TASK_VIDEO_CAPTION,
                source=source,
                filter_thinking_output=effective_filter_thinking_output
            )

            if result["success"]:
                success, content = postprocess_model_output(
                    result["content"],
                    filter_thinking_output=effective_filter_thinking_output,
                )
                if not success:
                    return {"success": False, "error": "API returned empty result after filtering reasoning content (Model only output thinking process)"}
                return {
                    "success": True,
                    "data": {"description": content}
                }
            else:
                return result

        except Exception as e:
            # Ensure progress bar is stopped on exception
            if 'pbar' in locals() and pbar and not getattr(pbar, '_closed', False):
                pbar.error(format_api_error(e, "VLM Service"))
            return {"success": False, "error": format_api_error(e, "VLM Service")}
