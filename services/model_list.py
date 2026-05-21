"""
Model List Service
Supports dynamic API fetching and predefined model lists
"""
import httpx
from typing import Dict, List

# Import unified log prefix
try:
    from ..utils.common import ERROR_PREFIX
except ImportError:
    # If import fails, use default value
    ERROR_PREFIX = "✨-Error"

# --- ZhipuAI predefined model list ---
ZHIPU_MODELS = [
    "glm-5.1",
    "glm-5",
    "glm-5-turbo",
    "glm-5v-turbo",
    "glm-4.7",
    "glm-4.7-flash",
    "glm-4.7-flashx",
    "glm-4.6",
    "glm-4.6v",
    "glm-4.6v-flash",
    "glm-4.5",
    "glm-4.5-flash",
    "glm-4.5-air",
    "glm-4.5-airx",
    "glm-4.5v",
    "glm-4-plus",
    "glm-4-flash",
    "glm-4-flash-250414",
    "glm-4-air",
    "glm-4-air-250414",
    "glm-z1-flash",
    "glm-4v-plus",
    "glm-4v-flash",
    "glm-4v",
    "glm-ocr",
    "glm-4-long",
    "glm-4-longwriter",
    "glm-zero-preview",
    "glm-4.1v-thinking-flash"
]

def get_models_from_service(base_url: str, api_key: str, service_type: str) -> Dict:

    """
    Fetch model list from service provider
    
    Args:
        base_url: API base URL
        api_key: API key
        service_type: Service type ('openai_compatible', 'ollama', 'zhipu')
    
    Returns:
        Dict: {
            "success": bool,
            "models": {"llm": [...], "vlm": [...]},  # when success=True
            "error": str  # error message when success=False
        }
    """
    try:
        # Check required parameters
        if not base_url:
            return {
                "success": False,
                "error": "Please fill in the Base URL"
            }
        
        # Zhipu uses predefined list, no API Key verification needed
        if service_type == 'zhipu':
            return _get_zhipu_models()
        
        if service_type == 'openai_compatible' and not api_key:
            return {
                "success": False,
                "error": "Please fill in the API Key"
            }
        
        # Call different fetch methods based on service type
        if service_type == 'ollama':
            return _fetch_ollama_models(base_url)
        else:  # openai_compatible
            return _fetch_openai_compatible_models(base_url, api_key)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Exception fetching model list: {str(e)}")
        return {
            "success": False,
            "error": f"Fetch failed: {str(e)}"
        }


def _fetch_openai_compatible_models(base_url: str, api_key: str) -> Dict:
    """Fetch model list from OpenAI-compatible API"""
    try:
        url = f"{base_url.rstrip('/')}/models"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        
        response = httpx.get(url, headers=headers, timeout=10.0)
        
        if response.status_code == 401:
            return {
                "success": False,
                "error": "API Key error, authentication failed"
            }
        elif response.status_code == 404:
            return {
                "success": False,
                "error": "API address error, model endpoint not found"
            }
        elif response.status_code != 200:
            return {
                "success": False,
                "error": f"API returned error (HTTP {response.status_code})"
            }
        
        data = response.json()
        models = data.get('data', [])
        
        if not models:
            return {
                "success": False,
                "error": "No available models found"
            }
        
        # Extract model IDs and return (same list for LLM and VLM)
        model_ids = [m['id'] for m in models if 'id' in m]
        
        return {
            "success": True,
            "models": {
                "llm": model_ids.copy(),
                "vlm": model_ids.copy()
            }
        }
        
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Request timed out, please check network connection"
        }
    except httpx.ConnectError:
        return {
            "success": False,
            "error": "Unable to connect to service, please check the Base URL"
        }
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to fetch OpenAI-compatible models: {str(e)}")
        return {
            "success": False,
            "error": f"Failed to fetch model list: {str(e)}"
        }


def _fetch_ollama_models(base_url: str) -> Dict:
    """Fetch Ollama model list"""
    try:
        # Ollama native API is at root path, need to remove possible /v1 suffix
        clean_url = base_url.rstrip('/')
        if clean_url.endswith('/v1'):
            clean_url = clean_url[:-3]
        
        url = f"{clean_url}/api/tags"
        
        # Add required request headers (referencing ollama-python SDK)
        import platform
        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': f'comfyui-prompt-assistant/1.0 ({platform.machine()} {platform.system().lower()}) Python/{platform.python_version()}'
        }
        
        # Create a client with proxy disabled to avoid system proxy interfering with localhost requests
        # This is a common cause of 502 errors: system proxy cannot correctly forward localhost requests
        with httpx.Client(proxy=None, trust_env=False) as client:
            response = client.get(url, headers=headers, timeout=10.0)
        
        if response.status_code == 404:
            return {
                "success": False,
                "error": "Ollama service not started or Base URL is incorrect"
            }
        elif response.status_code == 400:
            error_detail = response.text[:500] if response.text else "No response body"
            return {
                "success": False,
                "error": f"Ollama returned a 400 error. Details: {error_detail}"
            }
        elif response.status_code == 502:
            return {
                "success": False,
                "error": f"Ollama returned error (HTTP 502): Bad gateway, please check if Ollama service is running correctly"
            }
        elif response.status_code != 200:
            return {
                "success": False,
                "error": f"Ollama returned error (HTTP {response.status_code}): {response.text[:200]}"
            }
        
        data = response.json()
        models = data.get('models', [])
        
        if not models:
            return {
                "success": False,
                "error": "No Ollama models found"
            }
        
        # Extract model names and return (same list for LLM and VLM)
        model_names = [m['name'] for m in models if 'name' in m]
        
        return {
            "success": True,
            "models": {
                "llm": model_names.copy(),
                "vlm": model_names.copy()
            }
        }
        
    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "Request timed out, Ollama may not be started"
        }
    except httpx.ConnectError as e:
        print(f"{ERROR_PREFIX} Unable to connect to Ollama service: {str(e)}")
        return {
            "success": False,
            "error": "Unable to connect to Ollama service"
        }
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to fetch Ollama models: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": f"Failed to fetch Ollama models: {str(e)}"
        }


def _get_zhipu_models() -> Dict:
    """
    Get ZhipuAI's predefined model list
    ZhipuAI currently does not provide a public model list API, using a predefined list
    """
    return {
        "success": True,
        "models": {
            "llm": ZHIPU_MODELS.copy(),
            "vlm": ZHIPU_MODELS.copy()
        }
    }


