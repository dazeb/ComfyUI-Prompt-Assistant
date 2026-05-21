"""
Node abstract base class
Provides common base capabilities for all nodes, including thread management, interrupt detection, Provider config, etc.

V3 migration notes:
    All original instance methods (self) have been converted to class methods (cls) to meet V3's requirement that execute must be @classmethod.
"""

import asyncio
import threading
import time
from typing import Any, Callable, Dict, Optional, Tuple

from comfy.model_management import InterruptProcessingException

from ...utils.common import PREFIX as LOG_PREFIX, REQUEST_PREFIX, PROCESS_PREFIX


class BaseNode:
    """
    Abstract base class for all nodes (V3 Mixin version)

    Provides common functionality:
    - Thread execution and interrupt management
    - Provider config override
    - Rule template retrieval

    V3 note: All methods are @classmethod, callable as cls.method() directly in V3's execute(cls, ...).
    """

    # Subclasses can override these constants as needed
    LOG_PREFIX = LOG_PREFIX
    REQUEST_PREFIX = REQUEST_PREFIX
    PROCESS_PREFIX = PROCESS_PREFIX

    @classmethod
    def _run_thread_with_interrupt(
        cls,
        target_func: Callable,
        args: Tuple,
        task_name: str = "Task"
    ) -> Dict[str, Any]:
        """
        Run a task in a separate thread with interrupt detection support

        Parameters:
            target_func: Function to execute in the thread
            args: Tuple of arguments to pass to the function
            task_name: Task name (deprecated, kept for backward compatibility)

        Returns:
            The 'result' field content from result_container

        Raises:
            InterruptProcessingException: When user interrupt is detected
        """
        result_container = {}

        # Start thread
        thread = threading.Thread(target=target_func, args=args)
        thread.start()

        # Wait for completion while checking for interrupts
        while thread.is_alive():
            try:
                import nodes
                nodes.before_node_execution()
            except Exception:
                # Interrupt detected, throw immediately
                raise InterruptProcessingException()
            time.sleep(0.1)

        return result_container.get('result')

    @classmethod
    def _run_async_in_thread(
        cls,
        async_func: Callable,
        result_container: Dict[str, Any],
        *args,
        **kwargs
    ) -> None:
        """
        Helper method to run async tasks in a separate thread

        This method:
        1. Creates a new event loop
        2. Runs the async function
        3. Stores result in result_container
        4. Properly handles interrupt exceptions

        Parameters:
            async_func: Async function
            result_container: Result container dictionary
            *args, **kwargs: Arguments passed to async_func

        Result:
            result_container['result'] = function return value or error message
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(async_func(*args, **kwargs))
            result_container['result'] = result
        except (asyncio.CancelledError, KeyboardInterrupt):
            # Capture interrupt exception, do not format error
            print(f"{cls.LOG_PREFIX} Async task cancelled detected")
            result_container['result'] = {"success": False, "error": "Task interrupted"}
        except Exception as e:
            # Capture other exceptions, let subclass handle formatting
            result_container['result'] = {"success": False, "error": str(e)}
        finally:
            loop.close()

    @classmethod
    def _execute_with_interrupt(
        cls,
        thread_func: Callable,
        thread_args: Tuple,
        cancel_event: Optional[Any] = None
    ) -> Any:
        """
        Execute a thread task with interrupt detection (general wrapper)

        Parameters:
            thread_func: Function to run in thread (usually contains async logic)
            thread_args: Arguments passed to thread_func
            cancel_event: Optional cancel event to notify async task of interrupt

        Returns:
            Content of result_container['result']

        Raises:
            InterruptProcessingException: When user interrupt is detected
        """
        result_container = {}

        # If cancel_event is provided, pass it to thread_func
        if cancel_event is not None:
            thread = threading.Thread(
                target=thread_func,
                args=(result_container, cancel_event) + thread_args
            )
        else:
            thread = threading.Thread(
                target=thread_func,
                args=(result_container,) + thread_args
            )
        thread.start()

        # Wait for completion while checking for interrupts
        while thread.is_alive():
            is_interrupted = False
            try:
                import nodes
                nodes.before_node_execution()

                # Double check: also check PromptServer's global interrupt status
                # In some cases nodes.before_node_execution() may not throw an exception
                from server import PromptServer
                if (hasattr(PromptServer.instance, 'execution_interrupted')
                        and PromptServer.instance.execution_interrupted):
                    is_interrupted = True
            except Exception:
                is_interrupted = True

            if is_interrupted:
                # Interrupt detected, set cancel event if provided
                if cancel_event is not None:
                    try:
                        cancel_event.set()
                    except Exception:
                        pass
                raise InterruptProcessingException()
            time.sleep(0.1)

        return result_container.get('result')

    @classmethod
    def _override_ollama_config(
        cls,
        provider_config: Dict[str, Any],
        auto_unload: bool
    ) -> Dict[str, Any]:
        """
        Override the auto_unload parameter in Ollama config

        Parameters:
            provider_config: Original Provider config
            auto_unload: Node-level auto-unload setting

        Returns:
            New config dictionary (does not modify original)
        """
        config_copy = provider_config.copy()
        config_copy['auto_unload'] = auto_unload
        return config_copy

    @classmethod
    def _service_requires_api_key(cls, service: Optional[Dict[str, Any]]) -> bool:
        """
        Decide whether a node should block execution before calling the service
        because the API key is missing.
        """
        if not service:
            return True

        service_type = str(service.get('type', '') or '').strip().lower()
        if service_type == 'ollama':
            return False

        for key in ('requires_api_key', 'api_key_required', 'auth_required'):
            if service.get(key) is False:
                return False

        base_url = str(service.get('base_url', '') or '').strip().lower()
        local_hosts = ('localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1')
        if any(host in base_url for host in local_hosts):
            return False

        return True

    @classmethod
    def _get_prompt_template(
        cls,
        template_name: str,
        prompt_type: str,
        use_temp_rule: bool,
        temp_rule_content: str,
        default_content: str
    ) -> Tuple[str, str]:
        """
        Get prompt template content

        Parameters:
            template_name: Template name
            prompt_type: Template type ('expand_prompts', 'vision_prompts', etc.)
            use_temp_rule: Whether to use temporary rule
            temp_rule_content: Temporary rule content
            default_content: Default prompt content

        Returns:
            Tuple of (prompt_content, rule_name)
        """
        # Use temporary rule
        if use_temp_rule and temp_rule_content:
            return temp_rule_content, "Temporary Rule"

        # Get template from config
        from ...config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        if not system_prompts:
            return default_content, "Default Rule"

        prompts = system_prompts.get(prompt_type, {})
        if not prompts:
            return default_content, "Default Rule"

        # Match by display name
        for key, value in prompts.items():
            if value.get('name') == template_name:
                content = value.get('content', '')
                if content:
                    return content, template_name

        # Match by key name
        for key, value in prompts.items():
            if key == template_name:
                content = value.get('content', '')
                if content:
                    return content, template_name

        # Not found, use default
        return default_content, "Default Rule"
