"""
OpenAI compatible service base class
Provides unified OpenAI compatible API handling logic for LLM and VLM services
"""

import json
import time
import asyncio
import httpx
from typing import Optional, Dict, Any, List, Callable
from .core import BaseAPIService, HTTPClientPool
from .ollama_utils import wait_before_ollama_unload
from ..utils.common import (
    format_api_error, ProgressBar, log_complete, log_error,
    PREFIX, PROCESS_PREFIX, WARN_PREFIX, ERROR_PREFIX, format_elapsed_time,
    TASK_IMAGE_CAPTION, TASK_VIDEO_CAPTION
)
from .thinking_control import build_thinking_suppression


class OpenAICompatibleService(BaseAPIService):
    """
    OpenAI compatible API service base class
    Handles all OpenAI format API requests (Zhipu, SiliconFlow, 302.ai, Ollama, etc.)
    """
    
    # --- Known API endpoint paths (for smart detection) ---
    _known_endpoints = ['/chat/completions', '/v1/messages', '/completions']
    
    @staticmethod
    def parse_api_url(raw_url: str) -> str:
        """
        Smart parse base_url, generate the final request URL

        Rules:
        1. '#' suffix -> force use the full address (remove #)
        2. Already contains known endpoint path -> use directly, no further concatenation
        3. Otherwise -> append /chat/completions normally

        Args:
            raw_url: The raw URL entered by the user

        Returns:
            str: The final request URL
        """
        if not raw_url:
            return ''
        
        url = raw_url.strip()
        
        # Rule 1: Hash force mode - user explicitly wants to use the full address
        if url.endswith('#'):
            return url[:-1].rstrip('/')

        # Rule 2: Smart detection - check if URL already contains a known API endpoint
        for endpoint in OpenAICompatibleService._known_endpoints:
            if endpoint in url:
                # Already contains the full endpoint, return directly (remove trailing slash)
                return url.rstrip('/')

        if 'api.openai.com' in url and '/v1' not in url:
            url = url.rstrip('/') + '/v1'

        # Rule 3: Normal mode - need to append /chat/completions
        return url.rstrip('/') + '/chat/completions'
    
    # _provider_base_urls and _provider_display_names removed, related logic now managed by config_manager
    
    @staticmethod
    def _filter_payload(payload: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        Clean the request body based on retry level (simplified 3-level degradation strategy)

        Level 0: Full request (send as configured by user)
        Level 1: Remove thinking chain parameters (thinking, enable_thinking, reasoning_effort, etc.)
        Level 2: Minimal usable set (only model, messages, stream)
        """
        if level <= 0:
            return payload.copy()
            
        filtered = payload.copy()
        
        # Note: response_format on strict providers like Zhipu GLM-4V triggers 400 error, Level-1 also removes it
        thinking_keys = [
            "thinking", "enable_thinking", "reasoning_effort", 
            "reasoning", "thinking_level", "think",
            "response_format",  # BUG-02 fix: Level-1 also removes it to prevent some providers from rejecting this field
        ]
        for k in thinking_keys:
            filtered.pop(k, None)

        if level >= 2:
            # Level 2: Minimal usable set - keep only required parameters
            core_keys = ["model", "messages", "stream"]
            filtered = {k: filtered[k] for k in core_keys if k in filtered}
            
        return filtered

    @staticmethod
    def _merge_system_prompts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Merge multiple System Messages into a single entry
        Place the System Message at the beginning of the list
        Fix the issue where some providers do not support multiple System Messages
        """
        system_contents = []
        other_messages = []
        
        for msg in messages:
            if msg.get('role') == 'system':
                content = msg.get('content', '')
                if content:
                    system_contents.append(content)
            else:
                other_messages.append(msg)
        
        if not system_contents:
            return messages
            
        # Merge content
        merged_system = "\n\n".join(system_contents)

        # Build new list: System first + other messages
        return [{"role": "system", "content": merged_system}] + other_messages

    @classmethod
    async def _http_request_chat_completions(
        cls,
        base_url: str,
        api_key: str,
        model: str,
        messages: List[Dict[str, Any]],
        temperature: float = 0.7,
        top_p: float = 0.9,
        max_tokens: int = 2000,
        thinking_extra: Optional[Dict[str, Any]] = None,
        enable_advanced_params: bool = False,
        stream_callback: Optional[Callable[[str], None]] = None,
        request_id: Optional[str] = None,
        provider_display_name: str = "unknown service",
        cancel_event: Optional[Any] = None,
        task_type: str = None,
        source: str = None,
        filter_thinking_output: bool = True
    ) -> Dict[str, Any]:
        """
        Use HTTP direct connection to call /chat/completions endpoint
        Unified handling of all OpenAI-compatible providers (supports 3-level degradation retry)

        Args:
            enable_advanced_params: Whether to send advanced parameters (temperature/top_p/max_tokens)
        """
        from ..server import is_streaming_progress_enabled
        
        try:
            # Clean input params
            base_url = cls._sanitize_config_str(base_url)
            api_key = cls._sanitize_config_str(api_key)

            # Build request URL
            url = cls.parse_api_url(base_url)

            # Pre-process: Merge System Prompts (Level 0 applies by default)
            merged_messages = cls._merge_system_prompts(messages)

            # Build base request body (only required params)
            initial_payload = {
                "model": model,
                "messages": merged_messages,
                "stream": True
            }
            
            # For vision tasks (image/video captioning), certain models strictly require max_tokens,
            # otherwise it triggers openai_error, compatible V1
            is_vision_task = task_type in [TASK_IMAGE_CAPTION, TASK_VIDEO_CAPTION] if task_type else False

            # Only send temperature, top_p, max_tokens when user enables "Advanced Parameters" (vision tasks force sending)
            if enable_advanced_params or is_vision_task:
                initial_payload["temperature"] = temperature
                initial_payload["top_p"] = top_p
                if is_vision_task and not enable_advanced_params:
                    # BUG-07 fix: When vision tasks force send max_tokens, use a conservative upper bound
                    # Some relay providers (e.g., Gemini Flash via proxy) have max_tokens cap at 1024-1500
                    # Use min(max_tokens, 1500) as fallback to reduce compatibility issues
                    initial_payload["max_tokens"] = min(max_tokens, 1500)
                else:
                    initial_payload["max_tokens"] = max_tokens

            # Add thinking chain control parameters

            # Add thinking chain control parameters
            if thinking_extra:
                initial_payload.update(thinking_extra)
            
            # Build request headers
            headers = {"Content-Type": "application/json"}
            if api_key and api_key.strip():
                headers["Authorization"] = f"Bearer {api_key}"
            
            # Get HTTP client
            request_timeout = 180.0
            if task_type in (TASK_IMAGE_CAPTION, TASK_VIDEO_CAPTION):
                request_timeout = 300.0
            client = HTTPClientPool.get_client(
                provider=provider_display_name,
                base_url=base_url,
                timeout=request_timeout
            )

            # Pre-execution interrupt check: don't start request if ComfyUI already interrupted
            from server import PromptServer
            if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                return {"success": False, "error": "Task interrupted", "interrupted": True}
            
            # Create unified progress bar (automatically handles wait -> generate -> complete lifecycle)
            pbar = ProgressBar(
                request_id=request_id,
                service_name=provider_display_name,
                streaming=is_streaming_progress_enabled(),
                task_type=task_type,
                source=source
            )
            
            start_time = time.perf_counter()
            last_error_msg = ""
            
            # 3-level degradation retry loop (Level 0 -> Level 2)
            for retry_level in range(3):
                current_payload = cls._filter_payload(initial_payload, retry_level)

                # If not Level 0, print degradation retry warning
                if retry_level > 0:
                    removed_keys = set(initial_payload.keys()) - set(current_payload.keys())
                    removed_str = ", ".join(removed_keys) if removed_keys else "no param changes"
                    print(f"\\n{WARN_PREFIX} HTTP 400 error, triggering Level-{retry_level} degradation retry | Service:{provider_display_name} | Removed params:[{removed_str}]", flush=True)

                    # Key fix: Stop the old progress bar before creating a new one, prevent thread leak
                    if pbar:
                        try:
                            pbar.error(f"Retry Level {retry_level}...") # Mark previous progress bar as error/retry state
                        except:
                            pbar._stop_timer()

                    # Recreate progress bar for the new retry round
                    # Recreate progress bar for the new retry round
                    pbar = ProgressBar(
                        request_id=request_id,
                        service_name=provider_display_name,
                        extra_info=f"Retry-{retry_level}",
                        streaming=is_streaming_progress_enabled(),
                        task_type=task_type,
                        source=source
                    )
                
                async def _do_stream_request():
                    nonlocal pbar

                    # Define request core logic
                    async def _request_core():
                        async with client.stream('POST', url, headers=headers, json=current_payload, follow_redirects=True) as response:
                            if response.status_code != 200:
                                error_text = await response.aread()
                                try:
                                    error_data = json.loads(error_text)
                                    msg = error_data.get('error', {}).get('message', f'HTTP {response.status_code}')
                                except:
                                    msg = f'HTTP {response.status_code}: {error_text.decode("utf-8", errors="ignore")[:200]}'
                                
                                # Smart recognize authentication errors
                                from ..utils.common import _is_auth_error
                                if response.status_code == 401 or _is_auth_error(msg.lower()):
                                    msg = "Invalid or missing API Key"
                                
                                return {
                                    "success": False, 
                                    "error": msg, 
                                    "status_code": response.status_code,
                                    "should_retry": response.status_code == 400
                                }
                            
                            full_content = ""
                            reasoning_content = ""
                            stream_error = None  # Capture in-stream errors

                            async for line in response.aiter_lines():
                                # Keep the loop check here as an extra safety measure
                                if cancel_event is not None and cancel_event.is_set():
                                    raise asyncio.CancelledError()

                                if not line or line == "data: [DONE]" or line == "data:[DONE]": continue
                                if line.startswith("data: "): line = line[6:]
                                elif line.startswith("data:"): line = line[5:]

                                try:
                                    chunk = json.loads(line)
                                    # --- Debug log (level 2): output raw streaming data ---
                                    # print(f"[DEBUG-2] Chunk: {line[:200]}...", flush=True)

                                    # Key fix: Detect in-stream errors (some proxies return errors via HTTP 200 + SSE)
                                    if chunk.get('error'):
                                        err = chunk['error']
                                        if isinstance(err, dict):
                                            stream_error = err.get('message', str(err))
                                        else:
                                            stream_error = str(err)
                                        break  # Immediately abort stream reading

                                    if chunk.get('choices'):
                                        delta = chunk['choices'][0].get('delta', {})
                                        content = delta.get('content', '') or ''
                                        # Broad-spectrum capture of reasoning fields from different providers
                                        reasoning = (
                                            delta.get('reasoning_content', '') or 
                                            delta.get('reasoning', '') or 
                                            delta.get('thinking', '') or 
                                            delta.get('thinking_process', '') or  # fallback
                                            ''
                                        )
                                        if reasoning:
                                            reasoning_content += reasoning
                                            progress_count = len(full_content) + len(reasoning_content)
                                            pbar.set_generating(progress_count)
                                            pbar.update(progress_count)
                                        if content:
                                            full_content += content
                                            if stream_callback: stream_callback(content)
                                            progress_count = len(full_content) + len(reasoning_content)
                                            pbar.set_generating(progress_count)
                                            pbar.update(progress_count)
                                except json.JSONDecodeError:
                                    continue  # Non-JSON lines (e.g. comments, empty lines), skip normally
                                except asyncio.CancelledError:
                                    raise  # Must re-raise, cannot be swallowed
                                except Exception as chunk_err:
                                    # Other exceptions: log warning and continue, avoid interrupting the entire stream due to a single chunk error
                                    print(f"\\n{WARN_PREFIX} SSE chunk parse error: {chunk_err}", flush=True)
                                    continue

                            # If an error was detected in the stream, dynamically determine if degradation retry should be triggered
                            if stream_error:
                                # BUG-05 fix: Some proxies (xFlow/Grok etc.) return parameter errors via HTTP 200 + SSE error
                                # Should trigger degradation retry, not permanent failure
                                _RETRYABLE_STREAM_ERROR_KEYWORDS = [
                                    "unsupported", "invalid parameter", "invalid_request",
                                    "unknown field", "extra inputs", "not supported",
                                    "unrecognized", "unexpected", "disallowed",
                                    "does not support"
                                ]
                                stream_error_lower = stream_error.lower()
                                is_retryable_stream_error = any(
                                    kw in stream_error_lower
                                    for kw in _RETRYABLE_STREAM_ERROR_KEYWORDS
                                )
                                return {
                                    "success": False,
                                    "error": stream_error,
                                    "status_code": 200,  # HTTP level success, business level failure
                                    "should_retry": is_retryable_stream_error  # Dynamically determine if degradation retry should be triggered
                                }

                            final_content = full_content
                            # Only prepend reasoning_content back when the user has NOT enabled "filter thinking output"
                            if reasoning_content and not filter_thinking_output:
                                final_content = f"<think>{reasoning_content}</think>\n{full_content}"

                            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
                            if not final_content.strip():
                                pbar.error("Response content is empty")
                                # --- Debug log (level 1): warn that response content is empty ---
                                print(f"\n{WARN_PREFIX} [API Response Debug] Model:{model} | Status:success | But final content is empty string, triggering degradation retry", flush=True)
                                return {
                                    "success": False,
                                    "error": "API returned empty content",
                                    "status_code": 200,
                                    "should_retry": True
                                }
                            
                            pbar.done(char_count=len(final_content), elapsed_ms=elapsed_ms)
                            
                            return {"success": True, "content": final_content}

                    # Define monitor logic: check interrupt signal every 100ms
                    async def _monitor_interrupts(target_task):
                        while not target_task.done():
                            is_interrupted = False
                            if cancel_event is not None and cancel_event.is_set():
                                is_interrupted = True
                            else:
                                try:
                                    from server import PromptServer
                                    if hasattr(PromptServer.instance, 'execution_interrupted') and PromptServer.instance.execution_interrupted:
                                        is_interrupted = True
                                except:
                                    pass
                            
                            if is_interrupted:
                                target_task.cancel()
                                return True
                            await asyncio.sleep(0.1)
                        return False

                    # Run request and monitor concurrently
                    req_task = asyncio.create_task(_request_core())
                    monitor_task = asyncio.create_task(_monitor_interrupts(req_task))
                    
                    try:
                        result = await req_task
                        # Key fix: When API returns error, ensure progress bar is stopped
                        if not result.get("success") and not result.get("interrupted"):
                            if not getattr(pbar, '_closed', False):
                                pbar.error(result.get("error", "API error"))
                        return result
                    except asyncio.CancelledError:
                        pbar.cancel(f"{WARN_PREFIX} Task interrupted | Service:{provider_display_name}")
                        return {"success": False, "error": "Task interrupted", "interrupted": True}
                    finally:
                        if not monitor_task.done():
                            monitor_task.cancel()

                # Execute request
                try:
                    result = await _do_stream_request()
                except Exception as req_err:
                    # Network-level exceptions (non-HTTP response)

                    # Special handling for encoding errors (UnicodeEncodeError)
                    if isinstance(req_err, UnicodeEncodeError):
                        error_detail = "Network request encoding error: detected invalid characters (\u2026 or other non-ASCII chars). Please check if the API Key or URL in provider config contains extra ellipsis, quotes, or spaces."
                        if 'pbar' in locals() and pbar:
                            pbar.error(error_detail)
                        return {"success": False, "error": error_detail}

                    if 'pbar' in locals() and pbar:
                        pbar.error(f"Network request error: {req_err}")
                    return {"success": False, "error": f"Network request error: {req_err}"}

                # Check result
                if result["success"]:
                    # After Ollama service succeeds, try to unload model
                    if provider_display_name.lower().find("ollama") != -1:
                        try:
                            from ..config_manager import config_manager
                            service_config = config_manager.get_service(provider_display_name) or {}
                            # Inject the actual base_url used, prevent fallback to localhost causing VRAM cleanup failure
                            service_config['base_url'] = base_url
                            await cls._unload_ollama_model(model, service_config)
                        except:
                            pass
                    return result

                if result.get("interrupted"):
                    return result

                last_error_msg = result["error"]

                # Only continue looping when should_retry is True (HTTP 400) and retries remain
                if not result.get("should_retry"):
                    break # Non-400 errors (401, 500, etc.), do not perform degradation retry, return error directly

            # All retries exhausted or non-retryable error
            if 'pbar' in locals() and pbar:
                pbar.error(last_error_msg)
            return {"success": False, "error": last_error_msg}
        
        # Critical fix: separately catch CancelledError to ensure progress bar stops correctly
        except asyncio.CancelledError:
            if 'pbar' in locals() and pbar:
                pbar.cancel(f"{WARN_PREFIX} Task interrupted | Service:{provider_display_name}")
            return {"success": False, "error": "Task interrupted", "interrupted": True}
                    
        except Exception as e:
            if 'pbar' in locals() and pbar:
                pbar.error(format_api_error(e, provider_display_name))
            return {"success": False, "error": format_api_error(e, provider_display_name)}
    
    @staticmethod
    async def _unload_ollama_model(model: str, provider_config: Dict[str, Any]):
        """
        Unload Ollama model to free VRAM and memory

        Args:
            model: Model name
            provider_config: Provider config dictionary
        """
        try:
            # Check if auto-unload is enabled
            auto_unload = provider_config.get('auto_unload', True)
            if not auto_unload:
                from ..utils.common import PROCESS_PREFIX
                print(f"{PROCESS_PREFIX} Ollama model kept | Model:{model}")
                return

            await wait_before_ollama_unload()

            # Get base_url
            base_url = provider_config.get('base_url', 'http://localhost:11434')
            if base_url.endswith('/v1'):
                base_url = base_url[:-3]

            # Call Ollama API to unload model
            url = f"{base_url}/api/generate"
            payload = {
                "model": model,
                "keep_alive": 0
            }
            
            # Create temporary client (unload operation doesn't need reuse, disable proxy to prevent localhost requests from being intercepted)
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    from ..utils.common import PROCESS_PREFIX
                    print(f"{PROCESS_PREFIX} Ollama model unloaded | Model:{model}")

        except Exception as e:
            from ..utils.common import WARN_PREFIX
            print(f"{WARN_PREFIX} Ollama model unload failed (does not affect results) | Model:{model} | Error:{str(e)[:50]}")
    
    @classmethod
    def get_provider_display_name(cls, provider: str) -> str:
        """
        Get provider display name
        Prefer getting the real service name from config_manager, fallback to provider key
        """
        # Prefer trying to get service name from config_manager
        try:
            from ..config_manager import config_manager
            service = config_manager.get_service(provider)
            if service and 'name' in service:
                return service['name']
        except Exception:
            pass

        # Fallback to returning the key directly
        return provider
    
    @classmethod
    def get_provider_base_url(cls, provider: str, config: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """
        Get the base_url for a provider
        Only used for custom provider logic, other cases should get directly from config
        """
        if provider == 'custom' and config:
            base_url = config.get('base_url')
            # Ensure base_url does not end with /chat/completions
            if base_url and base_url.endswith('/chat/completions'):
                base_url = base_url[:-len('/chat/completions')]
            return base_url

        return None

    @staticmethod
    def _sanitize_config_str(s: str) -> str:
        """
        Clean illegal characters in config strings (e.g. spaces, quotes, invisible characters, etc.)
        Prevent request failures caused by copy-paste issues.

        Key fix: Return empty string "" when None or non-string is passed,
        avoid generating invalid auth headers like "Bearer None".
        """
        if not s or not isinstance(s, str):
            return ""  # Always return empty string, not None
        # 1. Remove leading/trailing spaces and common quotes
        s = s.strip().strip('"').strip("'")
        # 2. Remove common Unicode interfering characters (e.g., \u2026 ellipsis)
        # Note: We replace with empty string here because API Keys should not contain these characters
        s = s.replace('\u2026', '')
        # 3. Remove invisible tabs and newlines
        s = s.replace('\t', '').replace('\n', '').replace('\r', '')
        return s
