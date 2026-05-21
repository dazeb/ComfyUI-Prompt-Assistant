"""
LLM Node Base Class
Provides dedicated base capabilities for LLM-type nodes (expand, translate, etc.)

V3 Migration Notes:
    All original instance methods (self) have been converted to class methods (cls) to
    comply with the V3 requirement that execute() must be a @classmethod.
"""

import asyncio
from typing import Any, Callable, Dict, Optional

from .base_node import BaseNode
from ...utils.common import format_api_error


class LLMNodeBase(BaseNode):
    """
    LLM Node Base Class (V3 Mixin version)

    Provides LLM node-specific functionality:
    - LLM Provider configuration retrieval
    - LLM-related common logic
    - Dynamic service/model list generation
    """

    @staticmethod
    def get_llm_service_options():
        """
        Get all available LLM service/model option list

        Return format: ["Baidu Translate", "Zhipu/glm-4-flash", "Ollama/qwen3:14b", ...]
        Baidu Translate has no model concept, only displays service name;
        other services display as "service_name/model_name" format

        Returns:
            List[str]: Service/model option list
        """
        from ...config_manager import config_manager

        options = []
        services = config_manager.get_all_services()

        for service in services:
            service_name = service.get('name', '')
            service_type = service.get('type', '')

            # Baidu Translate special handling: only display service name
            if service_type == 'baidu':
                options.append(service_name)
                continue

            # Other services: iterate llm_models
            llm_models = service.get('llm_models', [])
            for model in llm_models:
                model_name = model.get('name', '')
                if model_name:
                    # Format: "service_name/model_name"
                    options.append(f"{service_name}/{model_name}")

        # If no options, return default to avoid ComfyUI errors
        if not options:
            options = ["Zhipu"]

        return options

    @staticmethod
    def get_translate_service_options():
        """
        Get service/model option list specifically for translation services

        Difference from get_llm_service_options:
        - Hard-coded "Baidu Translate" option (Baidu Translate uses independent config, not in model_services)
        - Specifically for translation node and translation button

        Return format: ["Baidu Translate", "Zhipu/glm-4-flash", "Ollama/qwen3:14b", ...]

        Returns:
            List[str]: Service/model option list (includes Baidu Translate)
        """
        from ...config_manager import config_manager

        options = []

        # ---Hard-coded Baidu Translate---
        # Baidu Translate uses independent baidu_translate config, not in model_services list
        config_manager.load_config().get('baidu_translate', {})
        # Always show Baidu option even without config app_id
        options.append("Baidu Translate")

        # ---Dynamically get other LLM services---
        services = config_manager.get_all_services()

        for service in services:
            service_name = service.get('name', '')

            # Iterate llm_models
            llm_models = service.get('llm_models', [])
            for model in llm_models:
                model_name = model.get('name', '')
                if model_name:
                    # Format: "service_name/model_name"
                    options.append(f"{service_name}/{model_name}")

        return options

    @staticmethod
    def parse_service_model(service_model_str: str):
        """
        Parse "service_name/model_name" format string

        Special handling:
        - "Baidu Translate": returns ('baidu', None) - uses independent config

        Args:
            service_model_str: Service/model string, e.g., "Zhipu/glm-4-flash" or "Baidu Translate"

        Returns:
            Tuple[str, Optional[str]]: (service_id, model_name)
            - service_id: Service ID (e.g., 'zhipu', 'baidu')
            - model_name: Model name, None if not applicable
        """
        from ...config_manager import config_manager

        # Split string
        if '/' in service_model_str:
            service_name, model_name = service_model_str.split('/', 1)
        else:
            service_name = service_model_str
            model_name = None

        # ---Special handling: Baidu Translate---
        if service_name in ['Baidu Translate', 'Baidu', 'baidu']:
            return 'baidu', None

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
        Get specified LLM Provider configuration

        Args:
            config_manager: Config manager instance
            provider: Provider identifier (e.g., 'zhipu', 'ollama', etc.)

        Returns:
            Provider config dict, or None if not found
        """
        llm_config = config_manager.get_llm_config()

        if 'providers' in llm_config and provider in llm_config['providers']:
            return llm_config['providers'][provider]

        return None

    @classmethod
    def _run_llm_task(
        cls,
        llm_service_func: Callable,
        provider: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Unified method for executing LLM tasks (expand/translate)

        Encapsulates:
        1. Async task thread execution
        2. Interrupt exception capture and handling
        3. API exception formatting

        Args:
            llm_service_func: LLMService async method
            provider: Provider name (for error formatting)
            *args, **kwargs: Arguments to pass to llm_service_func

        Returns:
            {"success": bool, "data": dict, "error": str} format result
        """
        def thread_task(result_container, cancel_event):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # Pass cancel_event to service function
                kwargs['cancel_event'] = cancel_event
                result = loop.run_until_complete(llm_service_func(*args, **kwargs))
                result_container['result'] = result
            except (asyncio.CancelledError, KeyboardInterrupt):
                print(f"{cls.LOG_PREFIX} Async task cancelled")
                result_container['result'] = {"success": False, "error": "Task interrupted"}
            except Exception as e:
                # Catch other exceptions, format error info
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
        import threading
        cancel_event = threading.Event()

        return cls._execute_with_interrupt(thread_task, (), cancel_event)
