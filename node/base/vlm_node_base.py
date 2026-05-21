"""
VLM Node Base Class
Provides dedicated base capabilities for VLM-type nodes (image captioning, video captioning, etc.)

V3 Migration Notes:
    All original instance methods (self) have been converted to class methods (cls) to
    comply with the V3 requirement that execute() must be a @classmethod.
"""

import asyncio
import threading
from typing import Any, Callable, Dict, Optional

import torch
from comfy.model_management import InterruptProcessingException

from .base_node import BaseNode
from ...utils.image import tensor_to_base64, compute_image_hash
from ...utils.common import format_api_error


class VLMNodeBase(BaseNode):
    """
    VLM Node Base Class (V3 Mixin version)

    Provides VLM node-specific functionality:
    - VLM Provider configuration retrieval
    - Image processing utility methods
    - Image hash computation
    - Unified async task execution with interrupt handling
    - Dynamic service/model list generation
    """

    @staticmethod
    def get_vlm_service_options():
        """
        Get all available VLM service/model option list

        Return format: ["Zhipu/glm-4v-flash", "Ollama/llava:Q6_K", ...]
        All services display as "service_name/model_name" format

        Returns:
            List[str]: Service/model option list
        """
        from ...config_manager import config_manager

        options = []
        services = config_manager.get_all_services()

        for service in services:
            service_name = service.get('name', '')
            service_type = service.get('type', '')

            # Baidu Translate has no vlm_models, skip
            if service_type == 'baidu':
                continue

            # Iterate vlm_models
            vlm_models = service.get('vlm_models', [])
            for model in vlm_models:
                model_name = model.get('name', '')
                if model_name:
                    # Format: "service_name/model_name"
                    options.append(f"{service_name}/{model_name}")

        # If no options, return default to avoid ComfyUI errors
        if not options:
            options = ["Zhipu"]

        return options

    @staticmethod
    def parse_service_model(service_model_str: str):
        """
        Parse "service_name/model_name" format string

        Args:
            service_model_str: Service/model string, e.g., "Zhipu/glm-4v-flash"

        Returns:
            Tuple[str, Optional[str]]: (service_id, model_name)
            - service_id: Service ID (e.g., 'zhipu', 'ollama')
            - model_name: Model name, None if not applicable
        """
        from ...config_manager import config_manager

        # Split string
        if '/' in service_model_str:
            service_name, model_name = service_model_str.split('/', 1)
        else:
            service_name = service_model_str
            model_name = None

        # Find corresponding service_id
        services = config_manager.get_all_services()
        for service in services:
            if service.get('name') == service_name:
                return service.get('id'), model_name

        # Not found, return None
        return None, None

    @classmethod
    def _get_provider_config(
        cls,
        config_manager: Any,
        provider: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get specified VLM Provider configuration

        Args:
            config_manager: Config manager instance
            provider: Provider identifier (e.g., 'zhipu', 'ollama', etc.)

        Returns:
            Provider config dict, or None if not found
        """
        vision_config = config_manager.get_vision_config()

        if 'providers' in vision_config and provider in vision_config['providers']:
            return vision_config['providers'][provider]

        return None

    @classmethod
    def _image_to_base64(cls, image_tensor: torch.Tensor, quality: int = 95) -> str:
        """
        Convert image tensor to base64 encoding

        Args:
            image_tensor: Image tensor
            quality: JPEG compression quality (1-100)

        Returns:
            Base64 encoded data URL
        """
        return tensor_to_base64(image_tensor, quality)

    @classmethod
    def _compute_image_hash(cls, image_tensor: Optional[torch.Tensor]) -> str:
        """
        Compute hash of image tensor (for fingerprint_inputs)

        Args:
            image_tensor: Image tensor or None

        Returns:
            MD5 hash hex string
        """
        return compute_image_hash(image_tensor)

    @classmethod
    def _run_async_task(
        cls,
        async_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Run async task in a separate thread and handle interrupts

        This method encapsulates:
        1. Async event loop creation and cleanup
        2. Interrupt exception capture and handling
        3. Normal exception formatting

        Args:
            async_func: Async function (coroutine function)
            provider: Provider name (for error formatting)
            *args, **kwargs: Arguments to pass to async_func

        Returns:
            {"success": bool, "data": dict, "error": str} format result
        """
        result_container = {}

        def thread_target():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # Execute async task
                result = loop.run_until_complete(async_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                # Capture interrupt exception, don't format error
                print(f"{cls.LOG_PREFIX} Detected async task cancelled")
                result_container['result'] = {"success": False, "error": "Task interrupted"}
            except Exception as e:
                # Capture other exceptions, format error info
                error_message = format_api_error(e, provider)
                result_container['result'] = {"success": False, "error": error_message}
            finally:
                loop.close()

        # Use base class thread interrupt detection method
        cls._run_thread_with_interrupt(
            thread_target,
            (),
            task_name="Async Task"
        )

    @classmethod
    def _run_vision_task(
        cls,
        vision_service_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Unified method for executing vision tasks (image/video analysis)

        Encapsulates:
        1. Async task thread execution
        2. Interrupt exception capture and handling
        3. API exception formatting

        Args:
            vision_service_func: VisionService async method (e.g., analyze_image, analyze_images)
            provider: Provider name (for error formatting, e.g., "zhipu")
            *args, **kwargs: Arguments to pass to vision_service_func

        Returns:
            {"success": bool, "data": dict, "error": str} format result

        Raises:
            InterruptProcessingException: When user interrupt is detected
        """
        def thread_task(result_container, cancel_event):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # Pass cancel_event to service function
                kwargs['cancel_event'] = cancel_event
                result = loop.run_until_complete(vision_service_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                # Capture interrupt exception, don't format error
                print(f"{cls.LOG_PREFIX} Detected async task cancelled")
                result_container['result'] = {"success": False, "error": "Task interrupted"}
            except Exception as e:
                # Capture other exceptions, format error info
                error_message = format_api_error(e, provider)
                result_container['result'] = {"success": False, "error": error_message}
            finally:
                # Clean up all unfinished tasks to eliminate "Task was destroyed but it is pending" warning
                try:
                    pending = asyncio.all_tasks(loop)
                    if pending:
                        for task in pending:
                            task.cancel()
                        # Wait for task cancellation to complete, ignore cancel errors
                        loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
                except Exception:
                    pass
                finally:
                    loop.close()

        # Create cancel event
        cancel_event = threading.Event()

        # Use base class interrupt detection execution
        return cls._execute_with_interrupt(thread_task, (), cancel_event)
