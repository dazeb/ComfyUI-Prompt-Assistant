"""
Utility function module
Integrates error handling, image processing, constants, and other common utilities
"""

import json
import base64
import sys
import os
import shutil
import re
import io
from io import BytesIO
from PIL import Image
from typing import Optional, Dict, Any
import time
import random
import threading

# Fix Windows terminal encoding issue
# Solve GBK encoding errors with emoji and special character output
if sys.platform == 'win32' and sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass  # Silently fail, keep original encoding


# ==================== Unified display width calculation ====================

def get_display_width(text: str) -> int:
    """
    Calculate the display width of a string in terminal (Chinese and some emoji take 2 cells, ASCII takes 1)
    """
    width = 0
    for char in text:
        # Common Chinese character encoding range
        if ord(char) > 0x7F:
            width += 2
        else:
            width += 1
    return width


# ==================== Unified log prefix constants ====================
# All modules import from here to ensure consistent log format

PREFIX = "✨"
ERROR_PREFIX = "✨-❌"
PROCESS_PREFIX = "✨"
REQUEST_PREFIX = "✨"
WARN_PREFIX = "✨-⚠️"


# ==================== Task type constants ====================
TASK_TRANSLATE = "Translation"
TASK_EXPAND = "Prompt Optimization"
TASK_IMAGE_CAPTION = "Image Captioning"
TASK_VIDEO_CAPTION = "Video Captioning"


# ==================== Request source constants ====================
SOURCE_NODE = "Node-"
SOURCE_FRONTEND = "Frontend-"


# ==================== Unified log message functions ====================

def log_prepare(
    task_type: str,
    request_id: str,
    source: str,
    service_name: str,
    model_name: str = None,
    rule_name: str = None,
    extra: dict = None
) -> None:
    """
    Output unified format preparation log (newline output)
    
    Format: ✨ 🟡 {source}{task} Ready | Service:{service} | Model:{model} | Rule:{rule} | ID:{id}
    """
    # Force carriage return and clear current line to avoid conflict with previous progress
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    
    parts = [f"{PREFIX} 🟡 {source}{task_type} Ready"]
    parts.append(f"Service:{service_name}")
    
    if model_name:
        parts.append(f"Model:{model_name}")
    if rule_name:
        parts.append(f"Rule:{rule_name}")
    
    parts.append(f"ID:{request_id}")
    
    # Handle extra fields
    if extra:
        for key, value in extra.items():
            parts.append(f"{key}:{value}")
    
    print(f"{parts[0]} | {' | '.join(parts[1:])}", flush=True)


def log_complete(
    task_type: str,
    request_id: str,
    service_name: str,
    char_count: int,
    elapsed_ms: int,
    model_unloaded: bool = None,
    source: str = None
) -> None:
    """
    Output unified format completion log (newline output)
    
    Format: ✨ ✅ {source}{task} Complete | Service:{service} | ID:{id} | Chars:{count} | Time:{time}
    """
    # Force carriage return without newline, clear current line, then output new message
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    
    elapsed_str = format_elapsed_time(elapsed_ms)
    source_str = source if source else ""
    parts = [f"{PREFIX} ✅ {source_str}{task_type} Complete"]
    parts.append(f"Service:{service_name}")
    parts.append(f"ID:{request_id}")
    parts.append(f"Chars:{char_count}")
    parts.append(f"Time:{elapsed_str}")
    
    # Ollama model unload status
    if model_unloaded is not None:
        unload_text = "Model Unloaded" if model_unloaded else "Model Kept"
        parts.append(unload_text)
    
    print(f"{parts[0]} | {' | '.join(parts[1:])}", flush=True)


def log_error(
    task_type: str,
    request_id: str,
    error_msg: str,
    source: str = None
) -> None:
    """
    Output unified format error log (newline output)
    """
    # Force carriage return and clear current line
    print(f"\r{_ANSI_CLEAR_EOL}", end="")
    source_str = source if source else ""
    print(f"{PREFIX} ❌ {source_str}{task_type} Failed | ID:{request_id} | Error:{error_msg}", flush=True)


def generate_request_id(req_type: str, service_type: Optional[str] = None, node_id: str = "0") -> str:
    """
    Generate unified format request ID
    Format: request_type_service_type(optional)_NodeID_4-digit_timestamp
    Example: trans_llm_12_3456
    """
    timestamp = str(int(time.time()))[-4:]
    parts = [req_type]
    if service_type:
        parts.append(service_type)
    parts.append(str(node_id))
    parts.append(timestamp)
    return "_".join(parts)


# ---Log formatting helper functions---

def simplify_model_name(model: str) -> str:
    """
    Simplify model name display
    
    Examples:
        huihui_ai/qwen3-vl-abliterated:8b -> qwen3-vl-8b
        huihui_ai/qwen3-abliterated:14b -> qwen3-14b
    
    Args:
        model: Full model name
    
    Returns:
        Simplified model name
    """
    if '/' in model:
        model = model.split('/')[-1]
    if ':' in model:
        name, size = model.split(':')
        # Remove common suffixes
        name = name.replace('-abliterated', '').replace('-instruct', '').replace('-chat', '')
        return f"{name}-{size}"
    return model

def format_model_with_thinking(model: str, thinking_disabled: bool = False) -> str:
    """
    Format model name, add 🗯 indicator if thinking is disabled
    
    Args:
        model: Model name
        thinking_disabled: Whether thinking chain is disabled
    
    Returns:
        Formatted model name
    """
    simplified = simplify_model_name(model)
    if thinking_disabled:
        return f"{simplified}💭"
    return simplified

def format_elapsed_time(elapsed_ms: int) -> str:
    """
    Format elapsed time display
    
    Args:
        elapsed_ms: Milliseconds
    
    Returns:
        Formatted time string (e.g., "6.5s")
    """
    return f"{elapsed_ms/1000:.1f}s"


# ====================Progress log system====================
# Unified progress bar manager, supports single-line overwrite refresh

# ---ANSI control sequences---
_ANSI_CLEAR_EOL = "\033[K"  # Clear from cursor to end of line

# ---Global state: track last output length (with lock for concurrency)---
_global_last_output_len = 0
_progress_lock = threading.Lock()


# ---Windows virtual terminal initialization---
def _enable_windows_vt():
    """
    Enable Windows virtual terminal processing
    Resolve ANSI escape sequence compatibility issues in Windows CMD/PowerShell
    """
    if os.name == 'nt':
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = ctypes.c_ulong()
            kernel32.GetConsoleMode(handle, ctypes.byref(mode))
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        except Exception:
            pass

_enable_windows_vt()


class ProgressBar:
    """
    Unified progress bar manager
    
    Manages the complete lifecycle of a request: Waiting -> Generating -> Complete
    Controls refresh frequency via streaming parameter:
    - streaming=True: High-frequency refresh (refreshes on every update)
    - streaming=False: Only refreshes on state changes (waiting->generating->complete)
    
    Both modes use single-line overwrite (\r), the difference is only in refresh frequency
    """
    
    # State constants
    STATE_WAITING = "waiting"
    STATE_GENERATING = "generating"
    STATE_DONE = "done"
    def __init__(
        self,
        request_id: str,
        service_name: str,
        extra_info: str = None,
        streaming: bool = True,
        task_type: str = None,
        source: str = None
    ):
        """
        Create progress bar
        
        Args:
            request_id: Request ID
            service_name: Service name (e.g., Ollama, OpenAI)
            extra_info: Extra info (e.g., Context:2048 | Timeout:60s)
            streaming: True=high-frequency refresh, False=refresh on state changes only
            task_type: Task type (for unified logging)
            source: Source (frontend/node)
        """
        self._request_id = request_id
        self._service_name = service_name
        self._extra_info = extra_info
        self._streaming = streaming
        self._task_type = task_type
        self._source = source
        
        self._state = self.STATE_WAITING
        self._char_count = 0
        self._start_time = time.perf_counter()
        self._last_refresh_time = 0.0  # New: record last refresh time for rate limiting
        self._closed = False
        self._stop_event = threading.Event()
        self._timer_thread = None
        
        # 1. Reset global length, start new progress tracking
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
        
        # Immediately show "waiting for response"
        self._refresh(force=True)
        
        # Start timer refresh thread only in streaming mode (static mode uses static logs, no second-precision refresh needed)
        if self._streaming:
            self._timer_thread = threading.Thread(target=self._timer_loop, daemon=True)
            self._timer_thread.start()
    
    def _format_elapsed(self) -> str:
        """Format elapsed time"""
        elapsed_sec = time.perf_counter() - self._start_time
        if elapsed_sec < 60:
            return f"{elapsed_sec:.1f}s"
        else:
            minutes = int(elapsed_sec // 60)
            seconds = int(elapsed_sec % 60)
            return f"{minutes}m{seconds}s"
    
    def _render(self) -> str:
        """Render current progress bar content"""
        elapsed = self._format_elapsed()
        
        if self._state == self.STATE_WAITING:
            # Waiting for response: ✨ 🟠 Waiting for Ollama response...
            # Add timer in streaming mode, keep static in non-streaming mode
            base = f"{PREFIX} 🟠 Waiting for {self._service_name} response..."
            if not self._streaming:
                return base
            
            if self._extra_info:
                return f"{base} | {self._extra_info} | {elapsed}"
            else:
                return f"{base} | {elapsed}"
        
        elif self._state == self.STATE_GENERATING:
            # Streaming mode: show char count and time
            # Static mode: show simple "Generating..."
            if self._streaming:
                return f"{PREFIX} 🔵 Generating | {self._char_count} chars | {elapsed}"
            else:
                return f"{PREFIX} 🔵 Generating..."
        
        else:
            return ""
    
    def _refresh(self, force: bool = False) -> None:
        """Internal refresh method: single-line overwrite output"""
        if self._closed:
            return
            
        # Rate limiting: if not forced, limit max frequency to 0.3 seconds to avoid excessive screen scrolling when environment doesn't support dynamic overwrite
        now = time.perf_counter()
        if not force and (now - self._last_refresh_time < 0.3):
            return
            
        self._last_refresh_time = now
        
        output = self._render()
        if not output:
            return
        
        with _progress_lock:
            global _global_last_output_len
            # Calculate display width of current content (fix len() inaccuracy with Chinese/emoji)
            current_width = get_display_width(output)
            
            # Fill with spaces to overwrite previous longer output (fallback when ANSI fails)
            padding = ""
            if _global_last_output_len > current_width:
                padding = " " * (_global_last_output_len - current_width)
            
            # Use \r to return to start of line, send ANSI clear first (instant if supported)
            # Then output content + space padding (for ANSI failure) + clear again (prevent trailing residue)
            # Add 2 space buffer to avoid clashing with other logs
            print(f"\r{_ANSI_CLEAR_EOL}{output}{padding}{_ANSI_CLEAR_EOL}  ", end='', flush=True)
            
            # Record display width (including buffer spaces)
            _global_last_output_len = current_width + len(padding)

    def _stop_timer(self):
        """Stop timer thread"""
        self._stop_event.set()
        # Force state to closed to prevent re-entry
        self._closed = True

    def _timer_loop(self):
        """Background thread: periodically refresh timer only in streaming mode"""
        try:
            while not self._stop_event.is_set() and not self._closed:
                # Periodically refresh current content (mainly for updating WAITING phase time)
                self._refresh(force=True)
                
                # Lower refresh frequency: every 0.3 seconds, significantly reduce screen scrolling when dynamic overwrite is unsupported
                if self._stop_event.wait(0.3):
                    break
        except Exception:
            pass  # Daemon thread exceptions should not affect main flow
    
    def set_generating(self, char_count: int = 0) -> None:
        """
        Switch to "generating" state
        
        Args:
            char_count: Current character count
        """
        if self._closed or self._state == self.STATE_GENERATING:
            return
        
        self._state = self.STATE_GENERATING
        self._char_count = char_count
        self._refresh(force=True)  # Always force refresh on state change
    
    def update(self, char_count: int) -> None:
        """
        Update character count
        
        Streaming mode: refresh on every call
        Static mode: no refresh (avoid screen scrolling)
        
        Args:
            char_count: Current character count
        """
        if self._closed:
            return
        
        self._char_count = char_count
        
        # Streaming mode: high-frequency refresh (actual frequency limited by _refresh rate limiting)
        if self._streaming:
            self._refresh(force=False)
        # Static mode: don't refresh here, only refresh on state change
    
    def done(self, message: str = None, char_count: int = None, elapsed_ms: int = None) -> None:
        """
        Complete request
        
        Args:
            message: Custom completion message (optional)
            char_count: Final character count (optional)
            elapsed_ms: Elapsed time in ms (optional, auto-calculated if not provided)
        """
        if self._closed:
            return
        
        self._stop_timer()
        self._state = self.STATE_DONE

        
        # Reset global length
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0

        # If task_type is provided, use unified log
        if hasattr(self, '_task_type') and self._task_type:
            log_complete(
                self._task_type or "Task", 
                self._request_id, 
                self._service_name, 
                char_count if char_count is not None else self._char_count,
                elapsed_ms if elapsed_ms is not None else int((time.perf_counter() - self._start_time) * 1000),
                source=getattr(self, '_source', None)
            )
            return

        # Backward compatibility: original done logic
        # Calculate elapsed time
        if elapsed_ms is not None:
            elapsed = format_elapsed_time(elapsed_ms)
        else:
            elapsed = self._format_elapsed()
        
        # Use passed char count or current char count
        final_count = char_count if char_count is not None else self._char_count
        
        # Generate completion message
        if message:
            final_msg = message
        else:
            final_msg = f"{PREFIX} ✅ Complete | Service:{self._service_name} | ID:{self._request_id} | Chars:{final_count} | Time:{elapsed}"
        
        # Directly call the concept of log_complete: newline output, don't overwrite previous content
        print(f"\r{_ANSI_CLEAR_EOL}{final_msg}", flush=True)
    
    def error(self, message: str) -> None:
        """
        Output error message (newline output, not overwriting)
        
        Args:
            message: Error message
        """
        if self._closed:
            return
        
        self._stop_timer()

        
        # Reset global length
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
            
        # If task_type is provided, use unified log
        if hasattr(self, '_task_type') and self._task_type:
            log_error(self._task_type or "Task", self._request_id, message, source=getattr(self, '_source', None))
            return

        # Legacy mode
        print(f"\r{_ANSI_CLEAR_EOL}{message}", flush=True)
    
    def cancel(self, message: str = None) -> None:
        """
        Cancel request (newline output, not overwriting)
        
        Args:
            message: Custom cancel message (optional)
        """
        if self._closed:
            return
        
        self._stop_timer()

        
        # Reset global length
        with _progress_lock:
            global _global_last_output_len
            _global_last_output_len = 0
            
        cancel_msg = message or "Task Cancelled"
        
        # If task_type is provided, use unified log
        if hasattr(self, '_task_type') and self._task_type:
            log_error(self._task_type or "Task", self._request_id, cancel_msg, source=getattr(self, '_source', None))
            return

        # Legacy mode
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} {cancel_msg} | ID:{self._request_id}", flush=True)
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        if not self._closed:
            # On context exit, if done/error wasn't explicitly called, consider it successful
            self.done()

    def __del__(self):
        """Destructor: ensure timer stops when object is garbage collected"""
        try:
            # Only stop if timer is still running
            if hasattr(self, '_stop_event') and not self._stop_event.is_set():
                self._stop_timer()
        except:
            pass


# HTTP status code to English error message mapping
HTTP_STATUS_CODE_MESSAGES = {
    400: "Bad Request",
    401: "Authentication Failed - Please check if your API Key is correct.",
    403: "Access Denied - You do not have permission to access this resource.",
    404: "Requested resource not found",
    429: "Rate Limit Exceeded - You have exceeded the rate limit, please try again later.",
    500: "Internal Server Error - An unknown issue occurred on the service provider side.",
    502: "Bad Gateway",
    503: "Service Unavailable - The server is currently unable to process the request, please try again later.",
    504: "Gateway Timeout",
}

# Baidu Translate API error code mapping
BAIDU_ERROR_CODE_MESSAGES = {
    '52001': 'Request timeout, please retry',
    '52002': 'System error, please retry',
    '52003': 'Unauthorized user, please check if appid is correct or if the service is activated',
    '54000': 'Required parameter is empty, please check if any parameters are missing',
    '54001': 'Signature error, please check if appid and secret_key are correct',
    '54003': 'Access frequency limited, please reduce your call frequency, or switch to Advanced/Enterprise version after identity authentication',
    '54004': 'Insufficient account balance, please recharge in the management console',
    '54005': 'Frequent long query requests, please reduce the sending frequency of long queries, retry after 3s',
    '58000': 'Illegal client IP, check if the IP address filled in your profile is correct',
    '58001': 'Translation language direction not supported, check if the target language is in the language list',
    '58002': 'Service is currently closed, please enable the service in Baidu management console',
    '58003': 'This IP has been banned',
    '90107': 'Authentication failed or not yet effective, please check the authentication progress in My Certifications',
    '20003': 'Request content has security risks',
}


# ---Error handling functions---

def _is_auth_error(error_text: str) -> bool:
    """
    Check if error message is authentication related
    
    Args:
        error_text: Error text (lowercase)
    
    Returns:
        bool: Whether it's an auth error
    """
    auth_keywords = [
        'invalid token',
        'authorization',
        'authenticate',
        'api key',
        'api_key',
        'unauthorized',
        'auth failed',
        'invalid key',
        'missing key',
        'invalid credentials',
        'authentication',
        'auth error',
        'token'
    ]
    return any(keyword in error_text for keyword in auth_keywords)

def format_api_error(e: Exception, provider_display_name: str) -> str:
    """
    Format error message from API
    Pure httpx implementation, does not depend on openai library
    
    Args:
        e: Exception object
        provider_display_name: Provider display name
    
    Returns:
        str: Formatted error message
    """
    # Handle encoding exception
    if isinstance(e, UnicodeEncodeError):
        return f"{provider_display_name} Network request encoding exception: Illegal characters detected. Please check if the API Key or URL in the provider config contains extraneous ellipsis, quotes, or spaces."

    # Handle httpx HTTP errors
    try:
        import httpx
        if isinstance(e, httpx.HTTPStatusError):
            status_code = e.response.status_code
            message = HTTP_STATUS_CODE_MESSAGES.get(status_code, "Unknown HTTP Error")
            
            error_details_str = ""
            detail_msg = ""
            
            try:
                error_details = e.response.json()
                detail_msg = error_details.get("message", "")
                if isinstance(error_details.get("error"), dict):
                    detail_msg = error_details["error"].get("message", detail_msg)
                
                if detail_msg:
                    error_details_str = f" | Details: {detail_msg}"
            except (json.JSONDecodeError, AttributeError):
                try:
                    if hasattr(e.response, 'text') and e.response.text:
                        detail_msg = e.response.text[:200]
                        error_details_str = f" | Raw Response: {detail_msg}"
                except Exception:
                    pass
            
            # ---Intelligent auth error detection with friendly prompt---
            combined_error_text = f"{message} {detail_msg}".lower()
            if status_code == 401 or _is_auth_error(combined_error_text):
                return f"{provider_display_name} Authentication failed: No API Key configured or API Key is invalid. Please fill in the correct API Key in provider settings."
                    
            return f"{provider_display_name} API Error: {message} (Status Code: {status_code}){error_details_str}"
    except Exception:
        pass
        
    # For other types of exceptions, return type and basic info
    return f"{provider_display_name} Service request exception: ({type(e).__name__}) {str(e)}"


def format_baidu_translate_error(error_data: dict) -> str:
    """
    Format Baidu Translate API error message
    
    Args:
        error_data: Baidu API returned error data
    
    Returns:
        str: Formatted error message
    """
    if not isinstance(error_data, dict):
        return "Unknown Baidu Translate error format"
        
    error_code = str(error_data.get('error_code'))
    if error_code in BAIDU_ERROR_CODE_MESSAGES:
        return f"Baidu Translate Error: {BAIDU_ERROR_CODE_MESSAGES[error_code]} (Code: {error_code})"
    
    error_msg = error_data.get('error_msg', 'Unknown error')
    return f"Baidu Translate Error: {error_msg} (Code: {error_code})"


# ---Image processing functions---

def get_optimal_image_params(image_count: int = 1) -> tuple:
    """
    Intelligently calculate optimal resolution and quality parameters based on image count
    Goal: Ensure API can return complete results while maintaining image quality as much as possible
    
    Args:
        image_count: Number of images (1-32)
    
    Returns:
        tuple: (max_size: tuple, quality: int, compression_level: str)
    """
    if image_count <= 1:
        # Single image: use medium quality
        return (1024, 1024), 75, "Medium"
    elif image_count <= 3:
        # 1-3 frames: maintain relatively high quality
        return (1024, 1024), 70, "High"
    elif image_count <= 6:
        # 4-6 frames: lower resolution, maintain medium quality
        return (768, 768), 70, "Medium"
    elif image_count <= 10:
        # 7-10 frames: further lower resolution and quality
        return (640, 640), 65, "Low"
    elif image_count <= 16:
        # 11-16 frames: use low resolution
        return (512, 512), 60, "Lower"
    else:
        # 17-32 frames: maximum compression, ensure processable
        return (480, 480), 55, "Lowest"


def preprocess_image(
    image_data: str,
    max_size: tuple = None,  # Changed to optional, supports auto-computation
    quality: int = None,  # Changed to optional, supports auto-computation
    request_id: Optional[str] = None,
    silent: bool = False,
    image_count: int = 1  # New: total number of images, used for dynamic adjustment
) -> str:
    """
    Preprocess image data (compress and resize)
    
    Args:
        image_data: Base64 encoded image data
        max_size: Maximum size, default None (auto-computed)
        quality: JPEG compression quality (1-100), default None (auto-computed)
        request_id: Request ID for log output
        silent: Silent mode (no log output)
        image_count: Total image count for intelligent optimization in multi-image scenarios
    
    Returns:
        str: Processed image data
    """
    try:
        # Intelligently calculate optimal parameters
        if max_size is None or quality is None:
            optimal_size, optimal_quality, compression_level = get_optimal_image_params(image_count)
            max_size = max_size or optimal_size
            quality = quality or optimal_quality
        else:
            compression_level = "Custom"
        
        # Check if data is base64 encoded image
        if image_data.startswith('data:image'):
            # Extract base64 data
            header, encoded = image_data.split(",", 1)
            image_bytes = base64.b64decode(encoded)
            original_bytes = len(image_bytes)
            
            # Open image
            img = Image.open(BytesIO(image_bytes))
            original_size = img.size
            
            # Calculate scale ratio
            if img.size[0] > max_size[0] or img.size[1] > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Convert to RGB (if RGBA)
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            
            # Compress image
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=quality, optimize=True)
            compressed_bytes = buffer.getvalue()
            compressed_size = len(compressed_bytes)
            
            # Encode to base64
            compressed_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
            processed_image_data = f"data:image/jpeg;base64,{compressed_b64}"
            
            # Output log
            if not silent:
                compression_ratio = (1 - compressed_size / original_bytes) * 100 if original_bytes > 0 else 0
                
                # Multi-image scenario shows compression level
                if image_count > 1:
                    print(
                        f"{REQUEST_PREFIX} 🟡 Image Preprocessing | "
                        f"Size:{original_size}->{img.size} | "
                        f"Bytes:{original_bytes/1024:.1f}KB->{compressed_size/1024:.1f}KB | "
                        f"Ratio:{compression_ratio:.1f}% | "
                        f"Level:{compression_level} ({image_count} frames)"
                    )
                else:
                    print(
                        f"{REQUEST_PREFIX} 🟡 Image Preprocessing Complete | "
                        f"Size:{original_size}->{img.size} | "
                        f"Bytes:{original_bytes/1024:.1f}KB->{compressed_size/1024:.1f}KB | "
                        f"Ratio:{compression_ratio:.1f}%"
                    )
            
            return processed_image_data
        
        # If not base64 encoded image data, return as-is
        return image_data
    
    except Exception as e:
        if not silent:
            print(f"{WARN_PREFIX} ❌Image preprocessing failed | Request ID:{request_id} | Error:{str(e)}")
        # Return original image data if preprocessing fails
        return image_data


def get_model_max_images(model: str) -> int:
    """
    Infer maximum supported image count based on model name
    
    Strategy: Optimistic default, precise limits for known models, safe default (10) for unknown models
    """
    model_lower = (model or "").lower()
    
    # Gemini series: large context supports many images
    if "gemini" in model_lower or "google" in model_lower:
        return 3000
    
    # Qwen series: give 100 image limit
    if "qwen" in model_lower:
        return 100
        
    # Zhipu GLM series
    if "glm" in model_lower:
        if "4.6v" in model_lower:
            return 100
        return 5
        
    # GPT-4 / GPT-5 series
    if "gpt-4" in model_lower or "gpt-5" in model_lower:
        return 100
        
    # Claude series
    if "claude" in model_lower:
        return 20
        
    # Grok series
    if "grok" in model_lower:
        return 20
        
    # Models with vision keywords (fallback)
    if any(keyword in model_lower for keyword in ["vision", "visual", "vl", "multimodal"]):
        return 100
        
    # Default: optimistic allowance, safe upper limit 10
    return 10


def check_multi_image_support(provider: str, model: str) -> tuple:
    """
    Backward compatible preserved old API, internally routes to get_model_max_images.
    """
    limit = get_model_max_images(model)
    return (True, limit)
