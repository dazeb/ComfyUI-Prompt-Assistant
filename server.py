from aiohttp import web
from server import PromptServer
from .config_manager import config_manager
from .services.baidu import BaiduTranslateService
from .services.llm import LLMService
from .services.vlm import VisionService
from .services.model_list import get_models_from_service
import base64
import json
import traceback
import asyncio
import folder_paths
import imageio
import os
from .utils.common import (
    # Unified log prefix (imported from common.py)
    PREFIX, ERROR_PREFIX, PROCESS_PREFIX,
    REQUEST_PREFIX, WARN_PREFIX,
    _ANSI_CLEAR_EOL,
    # Unified log functions and constants
    log_prepare, TASK_TRANSLATE, TASK_EXPAND, TASK_IMAGE_CAPTION, SOURCE_FRONTEND
)
from .utils.video import extract_frame_by_index, get_video_frame_info

# Dynamically get plugin directory name as base for route prefix
# This way, even if the folder is renamed (e.g. with a comfyui- prefix), routes auto-adapt
NODE_DIR_NAME = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
API_PREFIX = f'/{NODE_DIR_NAME}/api'

# print(f"{PREFIX} API routes mounted at: {API_PREFIX}")

# Validate active prompts at server initialization
config_manager.validate_and_fix_active_prompts()
# New: Complete model providers and parameters at startup
config_manager.validate_and_fix_model_params()



# Used to track active async tasks
ACTIVE_TASKS = {}

# --- Streaming progress settings (runtime state, takes effect immediately, no restart needed) ---
_streaming_progress_enabled = True

def is_streaming_progress_enabled():
    """For other modules to query current streaming progress setting"""
    return _streaming_progress_enabled

# RouteTableDef no longer used
# routes = web.RouteTableDef()

def get_result_text(result):
    """
    Intelligently extract text content from API response for character counting.
    Priority: data.translated > data.expanded > data.description > data.result > data.text > result > data (str)
    """
    if not isinstance(result, dict):
        return str(result) if result is not None else ''
    data = result.get('data')
    if isinstance(data, dict):
        for key in ['translated', 'expanded', 'description', 'result', 'text']:
            if key in data and isinstance(data[key], str):
                return data[key]
    if isinstance(data, str):
        return data
    if 'result' in result and isinstance(result['result'], str):
        return result['result']
    if 'text' in result and isinstance(result['text'], str):
        return result['text']
    return ''

# --- Streaming progress settings API ---

@PromptServer.instance.routes.get(f'{API_PREFIX}/settings/streaming_progress')
async def get_streaming_progress_setting(request):
    """Get streaming progress setting"""
    return web.json_response({"enabled": _streaming_progress_enabled})

@PromptServer.instance.routes.post(f'{API_PREFIX}/settings/streaming_progress')
async def set_streaming_progress_setting(request):
    """Set streaming progress (takes effect immediately, no restart needed)"""
    global _streaming_progress_enabled
    try:
        data = await request.json()
        _streaming_progress_enabled = data.get("enabled", True)
        return web.json_response({"success": True})
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to update streaming progress setting: {str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/baidu_translate')
async def get_baidu_translate_config(request):
    """Get Baidu Translate config"""
    config = config_manager.get_baidu_translate_config()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/llm')
async def get_llm_config(request):
    """Get LLM config"""
    config = config_manager.get_llm_config()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/vision')
async def get_vision_config(request):
    """Get vision model config"""
    config = config_manager.get_vision_config()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/translate')
async def get_translate_config(request):
    """Get translate service config"""
    config = config_manager.get_translate_config()
    return web.json_response(config)

# --- Plan A: API Key masked interface (secure version) ---

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/llm/masked')
async def get_llm_config_masked(request):
    """
    Get LLM config (API Key masked version)
    For frontend display, does not expose full API Key
    """
    config = config_manager.get_llm_config_masked()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/vision/masked')
async def get_vision_config_masked(request):
    """
    Get vision model config (API Key masked version)
    For frontend display, does not expose full API Key
    """
    config = config_manager.get_vision_config_masked()
    return web.json_response(config)

# --- Service provider management API interface (v2.0) ---

@PromptServer.instance.routes.get(f'{API_PREFIX}/services')
async def get_services_list(request):
    """
    Get all service providers list
    Returns all configured providers (excluding sensitive information)
    """
    try:
        services = config_manager.get_all_services()
        
        # Remove sensitive info
        safe_services = []
        for service in services:
            safe_service = service.copy()
            # Remove encrypted API Key
            if 'api_key_encrypted' in safe_service:
                del safe_service['api_key_encrypted']
            # Add masking info
            safe_service['has_api_key'] = bool(service.get('api_key_encrypted'))
            safe_services.append(safe_service)
        
        return web.json_response({
            "success": True,
            "services": safe_services
        })
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get service provider list | error:{str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/services/{{service_id}}/masked')
async def get_service_masked(request):
    """
    Get specified service provider config (masked version)
    API Key is masked, full value not exposed
    """
    try:
        service_id = request.match_info['service_id']
        service = config_manager.get_service(service_id)
        
        if not service:
            return web.json_response({
                "success": False,
                "error": f"Service provider does not exist: {service_id}"
            }, status=404)
        
        # Masking
        safe_service = service.copy()
        if 'api_key_encrypted' in safe_service:
            # Mask after decryption
            from .utils.common import SimpleEncryption
            api_key = SimpleEncryption.decrypt(safe_service['api_key_encrypted'])
            safe_service['api_key_masked'] = config_manager.mask_api_key(api_key)
            safe_service['api_key_exists'] = bool(api_key)
            del safe_service['api_key_encrypted']
        
        return web.json_response({
            "success": True,
            "service": safe_service
        })
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get service provider config | error:{str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/services')
async def create_service(request):
    """
    Create a new service provider
    Request body: {type, name, base_url, api_key, description}
    """
    try:
        data = await request.json()
        
        service_type = data.get('type')
        name = data.get('name')
        base_url = data.get('base_url', '')
        api_key = data.get('api_key', '')
        description = data.get('description', '')
        
        if not service_type or not name:
            return web.json_response({
                "success": False,
                "error": "Missing required parameters: type and name"
            }, status=400)
        
        service_id = config_manager.create_service(
            service_type=service_type,
            name=name,
            base_url=base_url,
            api_key=api_key,
            description=description
        )
        
        if service_id:
            print(f"{PREFIX} Successfully created service provider | name:{name} | ID:{service_id}")
            return web.json_response({
                "success": True,
                "service_id": service_id
            })
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to create service provider"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Exception creating service provider | error:{str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.put(f'{API_PREFIX}/services/{{service_id}}')
async def update_service_config(request):
    """
    Update service provider config
    Request body: {name, description, base_url, api_key, auto_unload}
    Note: API Key is only updated when payload contains api_key
    """
    try:
        service_id = request.match_info['service_id']
        data = await request.json()
        
        # Update service provider
        success = config_manager.update_service(service_id, **data)
        
        if success:
            print(f"{PREFIX} Successfully updated service provider | ID:{service_id}")
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to update service provider"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Exception updating service provider | error:{str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.delete(f'{API_PREFIX}/services/{{service_id}}')
async def delete_service(request):
    """
    Delete a service provider
    """
    try:
        service_id = request.match_info['service_id']
        
        success = config_manager.delete_service(service_id)
        
        if success:
            print(f"{PREFIX} Successfully deleted service provider | ID:{service_id}")
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to delete service provider"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Exception deleting service provider | error:{str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/services/{{service_id}}')
async def get_service(request):
    """
    Get specified service provider config
    """
    try:
        service_id = request.match_info.get('service_id')
        service = config_manager.get_service(service_id)
        
        if service:
            return web.json_response({
                "success": True,
                "service": service
            })
        else:
            return web.json_response({
                "success": False,
                "error": f"Service provider does not exist: {service_id}"
            }, status=404)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get service provider: {str(e)}")
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/services/current')
async def set_current_service_api(request):
    """
    Set current active service provider
    Request body: {service_type: 'llm'|'vlm'|'translate', service_id: string, model_name?: string}
    """
    try:
        data = await request.json()
        service_type = data.get('service_type')
        service_id = data.get('service_id')
        model_name = data.get('model_name')  # Optional parameter
        
        # Validate parameters
        if not service_type or not service_id:
            return web.json_response({
                "success": False,
                "error": "Missing required parameters: service_type and service_id"
            }, status=400)
        
        if service_type not in ['llm', 'vlm', 'translate']:
            return web.json_response({
                "success": False,
                "error": "service_type must be 'llm', 'vlm', or 'translate'"
            }, status=400)
        
        # Call config manager to set service (now supports model_name parameter)
        success = config_manager.set_current_service(service_type, service_id, model_name)
        
        if success:
            return web.json_response({
                "success": True,
                "message": f"Successfully set current {service_type} service"
            })
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to set service"
            }, status=500)
    except Exception as e:
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

# ====================== Model list API ======================

@PromptServer.instance.routes.get(f'{API_PREFIX}/services/{{service_id}}/models')
async def get_service_models(request):
    """
    Get model list for a service provider
    """
    try:
        service_id = request.match_info.get('service_id')
        
        # Get service provider info
        service = config_manager.get_service(service_id)
        
        if not service:
            print(f"{ERROR_PREFIX} Service provider does not exist | ID:{service_id}")
            return web.json_response({
                "success": False,
                "error": f"Service provider does not exist: {service_id}"
            }, status=404)
        
        base_url = service.get('base_url', '')
        api_key = service.get('api_key', '')
        service_type = service.get('type', 'openai_compatible')
        
        # Special handling: zhipu service forces 'zhipu' type (uses predefined list)
        if service_id == 'zhipu':
            service_type = 'zhipu'
        
        # Get model list (new format includes success and error)
        result = get_models_from_service(base_url, api_key, service_type)
        
        # Check if successful
        if not result.get('success'):
            error_msg = result.get('error', 'Unknown error')
            print(f"{ERROR_PREFIX} Failed to get model list: {error_msg}")
            return web.json_response({
                "success": False,
                "error": error_msg
            }, status=400)
        
        models = result.get('models', {'llm': [], 'vlm': []})
        
        # Count total models (LLM and VLM lists are the same, only count one)
        total_count = len(models.get('llm', []))
        print(f"{PREFIX} Model list retrieved successfully | total {total_count} models")
        
        return web.json_response({
            "success": True,
            "models": models
        })
        
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get model list: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


@PromptServer.instance.routes.post(f'{API_PREFIX}/services/{{service_id}}/models')
async def add_model_to_service_api(request):
    """
    Add model to service provider
    """
    try:
        service_id = request.match_info.get('service_id')
        data = await request.json()
        
        model_type = data.get('model_type')
        model_name = data.get('model_name')
        temperature = data.get('temperature', 0.7)
        top_p = data.get('top_p', 0.9)
        max_tokens = data.get('max_tokens', 4096)
        
        if not model_type or not model_name:
            return web.json_response({
                "success": False,
                "error": "Missing required parameters: model_type and model_name"
            }, status=400)
        
        success = config_manager.add_model_to_service(
            service_id, model_type, model_name, temperature, top_p, max_tokens
        )
        
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to add model"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to add model: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


@PromptServer.instance.routes.delete(f'{API_PREFIX}/services/{{service_id}}/models/{{model_type}}/{{model_name}}')
async def delete_model_from_service_api(request):
    """
    Delete model from service provider
    """
    try:
        service_id = request.match_info.get('service_id')
        model_type = request.match_info.get('model_type')
        model_name = request.match_info.get('model_name')
        
        success = config_manager.delete_model_from_service(service_id, model_type, model_name)
        
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to delete model"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to delete model: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


@PromptServer.instance.routes.put(f'{API_PREFIX}/services/{{service_id}}/models/default')
async def set_default_model_api(request):
    """
    Set default model
    """
    try:
        service_id = request.match_info.get('service_id')
        data = await request.json()
        
        model_type = data.get('model_type')
        model_name = data.get('model_name')
        
        if not model_type or not model_name:
            return web.json_response({
                "success": False,
                "error": "Missing required parameters: model_type and model_name"
            }, status=400)
        
        success = config_manager.set_default_model(service_id, model_type, model_name)
        
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to set default model"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to set default model: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


@PromptServer.instance.routes.put(f'{API_PREFIX}/services/{{service_id}}/models/order')
async def update_model_order_api(request):
    """
    Update model order
    """
    try:
        service_id = request.match_info.get('service_id')
        data = await request.json()
        
        model_type = data.get('model_type')
        model_names = data.get('model_names', [])
        
        if not model_type:
            return web.json_response({
                "success": False,
                "error": "Missing required parameter: model_type"
            }, status=400)
        
        success = config_manager.update_model_order(service_id, model_type, model_names)
        
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to update model order"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to update model order: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.put(f'{API_PREFIX}/services/order')
async def update_services_order_api(request):
    """
    Update service provider order

    Request body: {service_ids: ['id1', 'id2', ...]}
    """
    try:
        data = await request.json()
        service_ids = data.get('service_ids', [])

        if not service_ids:
            return web.json_response({
                "success": False,
                "error": "Missing required parameter: service_ids"
            }, status=400)

        success = config_manager.update_services_order(service_ids)

        if success:
            print(f"{PREFIX} Successfully updated service provider order | order:{', '.join(service_ids)}")
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to update service provider order"
            }, status=500)

    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to update service provider order: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


@PromptServer.instance.routes.put(f'{API_PREFIX}/services/{{service_id}}/models/parameter')
async def update_model_parameter_api(request):
    """
    Update model parameters
    """
    try:
        service_id = request.match_info.get('service_id')
        data = await request.json()
        
        model_type = data.get('model_type')
        model_name = data.get('model_name')
        parameter_name = data.get('parameter_name')
        parameter_value = data.get('parameter_value')
        
        if not all([model_type, model_name, parameter_name, parameter_value is not None]):
            return web.json_response({
                "success": False,
                "error": "Missing required parameters"
            }, status=400)
        
        success = config_manager.update_model_parameter(
            service_id, model_type, model_name, parameter_name, parameter_value
        )
        
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({
                "success": False,
                "error": "Failed to update model parameters"
            }, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to update model parameters: {str(e)}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            "success": False,
            "error": str(e)
        }, status=500)


# ====================== Config API ======================

def _load_ui_locale_messages(language: str):
    """Load UI locale messages"""
    # Base path
    locales_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "locales")
    
    # Try to load requested language, fallback to Chinese on failure
    locale_path = os.path.join(locales_dir, language, "ui.json")
    if os.path.exists(locale_path):
        normalized = language
    else:
        normalized = "zh"
        locale_path = os.path.join(locales_dir, normalized, "ui.json")
    
    try:
        with open(locale_path, "r", encoding="utf-8") as f:
            return normalized, json.load(f)
    except Exception as e:
        print(f"{ERROR_PREFIX} Unable to read language file {locale_path}: {str(e)}")
        # Final fallback, return empty dict
        return "zh", {}

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/ui_locale/{{language}}')
async def get_ui_locale(request):
    """Get frontend UI locale messages"""
    try:
        language = request.match_info.get("language", "zh")
        normalized, messages = _load_ui_locale_messages(language)
        return web.json_response({
            "success": True,
            "language": normalized,
            "messages": messages
        })
    except Exception as e:
        print(f"{ERROR_PREFIX} UI locale loading failed | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/system_prompts')
async def get_system_prompts_config(request):
    """Get system prompt config"""
    config = config_manager.get_system_prompts()
    return web.json_response(config)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/default_system_prompts')
async def get_default_system_prompts_config(request):
    """Get default system prompt config"""
    default_prompts = config_manager.default_system_prompts
    return web.json_response(default_prompts)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/tags')
async def get_tags_config(request):
    """Get tags config (deprecated, tags.json has been replaced by CSV system)"""
    try:
        # tags.json is deprecated, return empty object
        return web.json_response({})
    except Exception as e:
        print(f"{ERROR_PREFIX} Tags config loading failed | error:{str(e)}")
        return web.json_response({"error": str(e)}, status=500)



@PromptServer.instance.routes.get(f'{API_PREFIX}/config/tags_user')
async def get_user_tags_config(request):
    """Get user custom tag config"""
    try:
        # Load user tags using config manager
        user_tags = config_manager.load_user_tags()
        
        return web.json_response(user_tags)
    except Exception as e:
        print(f"{ERROR_PREFIX} User tags config loading failed | error:{str(e)}")
        return web.json_response({"error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/tags_user')
async def update_user_tags_config(request):
    """Update user custom tag config"""
    try:
        data = await request.json()
        
        # Check data structure
        if not isinstance(data, dict):
            print(f"{ERROR_PREFIX} User tags config update failed | error:invalid parameter format")
            return web.json_response({"error": "Invalid parameter format"}, status=400)
        
        # Save user tags using config manager
        success = config_manager.save_user_tags(data)
        
        if success:
            return web.json_response({"success": True})
        else:
            print(f"{ERROR_PREFIX} User tags config file update failed")
            return web.json_response({"error": "Save failed"}, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} User tags config update exception | error:{str(e)}")
        return web.json_response({"error": str(e)}, status=500)

# --- CSV tag system API ---

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/tags_files')
async def get_tags_files(request):
    """Get list of all CSV files in tags directory"""
    try:
        files = config_manager.list_tags_files()
        return web.json_response({"success": True, "files": files})
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get tag file list | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/tags_csv/{{filename}}')
async def get_tags_csv(request):
    """Load specified CSV tag file"""
    try:
        filename = request.match_info.get('filename')
        if not filename or not filename.endswith('.csv'):
            return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
        
        tags_data = config_manager.load_tags_csv(filename)
        return web.json_response({"success": True, "data": tags_data})
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to load CSV tag file | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/tags_csv/{{filename}}')
async def save_tags_csv(request):
    """Save tag data to specified CSV file"""
    try:
        filename = request.match_info.get('filename')
        if not filename or not filename.endswith('.csv'):
            return web.json_response({"success": False, "error": "Invalid filename"}, status=400)
        
        data = await request.json()
        tags_data = data.get('data', {})
        
        success = config_manager.save_tags_csv(filename, tags_data)
        if success:
            print(f"{PREFIX} CSV tag file saved successfully | file:{filename}")
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "Save failed"}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to save CSV tag file | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/tags_selection')
async def get_tags_selection(request):
    """Get user-selected tag file"""
    try:
        selection = config_manager.get_tags_selection()
        return web.json_response({"success": True, "selection": selection})
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get tag selection | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/tags_selection')
async def save_tags_selection(request):
    """Save user-selected tag file"""
    try:
        data = await request.json()
        success = config_manager.save_tags_selection(data)
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "Save failed"}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to save tag selection | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.get(f'{API_PREFIX}/config/favorites')
async def get_favorites(request):
    """Get favorites list"""
    try:
        favorites = config_manager.get_favorites()
        return web.json_response({"success": True, "favorites": favorites})
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to get favorites list | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/favorites/add')
async def add_favorite(request):
    """Add a single favorite"""
    try:
        data = await request.json()
        tag_value = data.get('tag_value')
        tag_name = data.get('tag_name')  # Get optional tag name
        category = data.get('category')  # Get optional category (source file)
        if not tag_value:
            return web.json_response({"success": False, "error": "Missing tag_value parameter"}, status=400)
        
        success = config_manager.add_favorite(tag_value, tag_name, category)
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "Add failed"}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to add favorite | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/favorites/remove')
async def remove_favorite(request):
    """Remove a single favorite"""
    try:
        data = await request.json()
        tag_value = data.get('tag_value')
        category = data.get('category')
        if not tag_value:
            return web.json_response({"success": False, "error": "Missing tag_value parameter"}, status=400)
        
        success = config_manager.remove_favorite(tag_value, category)
        if success:
            return web.json_response({"success": True})
        else:
            return web.json_response({"success": False, "error": "Remove failed"}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Failed to remove favorite | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/baidu_translate')
async def update_baidu_translate_config(request):
    """Update Baidu Translate config"""
    try:
        data = await request.json()
        app_id = data.get('app_id')
        secret_key = data.get('secret_key')
        
        # Get current config
        current_config = config_manager.get_baidu_translate_config()
        
        # If app_id is provided, update app_id
        if app_id is not None:
            current_config['app_id'] = app_id
            
        # If secret_key is provided, update secret_key
        if secret_key is not None:
            current_config['secret_key'] = secret_key
            
        # Update config
        success = config_manager.update_baidu_translate_config(
            current_config['app_id'],
            current_config['secret_key']
        )
        
        if success:
            return web.json_response({'message': 'Config updated'})
        else:
            print(f"{ERROR_PREFIX} Baidu Translate config update failed")
            return web.json_response({'error': 'Config update failed'}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Baidu Translate config update exception | error:{str(e)}")
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/system_prompts')
async def update_system_prompts_config(request):
    """Update system prompt config"""
    try:
        data = await request.json()
        
        # Check data structure
        if not isinstance(data, dict):
            print(f"{ERROR_PREFIX} System prompt config update failed | error:invalid parameter format")
            return web.json_response({'error': 'Invalid parameter format'}, status=400)
            
        # Frontend sends complete config with active_prompts, backend just validates and saves
        if 'active_prompts' not in data:
            print(f"{WARN_PREFIX} System prompt config update warning | error:missing active_prompts, trying to recover from existing config")
            # Even if missing, try to recover from current config for robustness
            current_config = config_manager.get_system_prompts()
            data['active_prompts'] = current_config.get('active_prompts', {
                "expand": None, "vision_zh": None, "vision_en": None
            })

        # Separate active_prompts for individual processing
        active_prompts_to_update = data.pop('active_prompts', None)
        
        # Clean up any isActive flags in prompt data (just in case)
        for prompt_type in ['expand_prompts', 'vision_prompts']:
            if prompt_type in data:
                for prompt_id, prompt_data in data[prompt_type].items():
                    if isinstance(prompt_data, dict) and 'isActive' in prompt_data:
                        del prompt_data['isActive']
        
        # Update prompt definitions
        success = config_manager.update_system_prompts(data)
        
        # If active_prompts exist, update them
        if active_prompts_to_update:
            success = success and config_manager.update_active_prompts(active_prompts_to_update)
        
        if success:
            active_prompts = active_prompts_to_update or {}
            expand_id = active_prompts.get('expand', 'none')
            vision_zh_id = active_prompts.get('vision_zh', 'none')
            vision_en_id = active_prompts.get('vision_en', 'none')
            print(f"{PREFIX} System prompt config updated successfully | active prompts: expand={expand_id}, vision_zh={vision_zh_id}, vision_en={vision_en_id}")
            
            # Validate active prompts after updating config
            print(f"{PREFIX} Validating updated active prompt config...")
            config_manager.validate_and_fix_active_prompts()
            
            return web.json_response({'success': True})
        else:
            print(f"{ERROR_PREFIX} System prompt config update failed")
            return web.json_response({'error': 'Config update failed'}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} System prompt config update exception | error:{str(e)}")
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/active_prompt')
async def update_active_prompt_config(request):
    """Update a single active prompt config"""
    try:
        data = await request.json()
        prompt_type = data.get('type')
        prompt_id = data.get('prompt_id')
        
        if not prompt_type or not prompt_id:
            return web.json_response({'error': 'Missing parameters type or prompt_id'}, status=400)
        
        success = config_manager.update_active_prompt(prompt_type, prompt_id)
        
        if success:
            print(f"{PREFIX} Active prompt updated | type:{prompt_type} | ID:{prompt_id}")
            
            # Validate config after updating single active prompt
            print(f"{PREFIX} Validating updated active prompt config...")
            config_manager.validate_and_fix_active_prompts()
            
            return web.json_response({'success': True})
        else:
            print(f"{ERROR_PREFIX} Active prompt update failed")
            return web.json_response({'error': 'Config update failed'}, status=500)
    except Exception as e:
        print(f"{ERROR_PREFIX} Active prompt update exception | error:{str(e)}")
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/llm')
async def update_llm_config(request):
    """Update LLM config"""
    try:
        data = await request.json()
        current_provider = data.get('current_provider')
        providers = data.get('providers', {})
        
        # Ensure at least one parameter is provided
        if not current_provider and not providers:
            print(f"{ERROR_PREFIX} LLM config update failed | error:parameters cannot all be empty")
            return web.json_response({'error': 'Parameters cannot all be empty'}, status=400)
            
        success = True
        
        # First update each provider's config
        if providers:
            # Update each provider's config one by one
            for provider, provider_config in providers.items():
                if provider not in ['zhipu', 'siliconflow', '302ai', 'ollama', 'custom']:
                    continue
                    
                model = provider_config.get('model')
                api_key = provider_config.get('api_key')
                base_url = provider_config.get('base_url')
                temperature = provider_config.get('temperature')
                max_tokens = provider_config.get('max_tokens')
                top_p = provider_config.get('top_p')
                auto_unload = provider_config.get('auto_unload')

                # Update config, but not current_provider
                success = success and config_manager.update_llm_config(
                    provider=provider,
                    model=model,
                    base_url=base_url,
                    api_key=api_key,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    top_p=top_p,
                    auto_unload=auto_unload,
                    update_current=False
                )
                
        # Finally update current provider
        if current_provider:
            success = success and config_manager.update_llm_config(
                provider=current_provider,
                update_current=True
            )
        
        if success:
            print(f"{PREFIX} LLM config updated successfully")
            return web.json_response({'success': True})
        else:
            print(f"{ERROR_PREFIX} LLM config update failed")
            return web.json_response({'error': 'Config update failed'}, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} LLM config update exception | error:{str(e)}")
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/config/vision')
async def update_vision_config(request):
    """Update vision model config"""
    try:
        data = await request.json()
        current_provider = data.get('current_provider')
        providers = data.get('providers', {})
        
        # Ensure at least one parameter is provided
        if not current_provider and not providers:
            print(f"{ERROR_PREFIX} Vision model config update failed | error:parameters cannot all be empty")
            return web.json_response({'error': 'Parameters cannot all be empty'}, status=400)
            
        success = True
        
        # First update each provider's config
        if providers:
            # Update each provider's config one by one
            for provider, provider_config in providers.items():
                if provider not in ['zhipu', 'siliconflow', '302ai', 'ollama', 'custom']:
                    continue
                    
                model = provider_config.get('model')
                api_key = provider_config.get('api_key')
                base_url = provider_config.get('base_url')
                temperature = provider_config.get('temperature')
                max_tokens = provider_config.get('max_tokens')
                top_p = provider_config.get('top_p')
                auto_unload = provider_config.get('auto_unload')

                # Update config, but not current_provider
                success = success and config_manager.update_vision_config(
                    provider=provider,
                    model=model,
                    base_url=base_url,
                    api_key=api_key,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    top_p=top_p,
                    auto_unload=auto_unload,
                    update_current=False
                )
                
        # Finally update current provider
        if current_provider:
            success = success and config_manager.update_vision_config(
                provider=current_provider,
                update_current=True
            )
        
        if success:
            print(f"{PREFIX} Vision model config updated successfully")
            return web.json_response({'success': True})
        else:
            print(f"{ERROR_PREFIX} Vision model config update failed")
            return web.json_response({'error': 'Config update failed'}, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Vision model config update exception | error:{str(e)}")
        return web.json_response({'error': str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/request/cancel')
async def cancel_request(request):
    """Cancel an active async request"""
    try:
        data = await request.json()
        request_id = data.get("request_id")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        task = ACTIVE_TASKS.get(request_id)
        if task and not task.done():
            task.cancel()
            # Remove cancelled task from dict
            del ACTIVE_TASKS[request_id]
            print(f"{WARN_PREFIX} Request cancelled | ID:{request_id}")
            return web.json_response({"success": True, "message": "Request cancelled"})
        else:
            return web.json_response({"success": False, "error": "No active task found or task already completed"}, status=404)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Exception occurred while cancelling request | error:{error_msg}")
        return web.json_response({"success": False, "error": error_msg}, status=500)

# New API routes

@PromptServer.instance.routes.post(f'{API_PREFIX}/baidu/translate')
async def baidu_translate(request):
    """
    Baidu Translate API
    Note: All format handling (including numbering "1." format protection etc.) is done by frontend promptFormatter.js,
    Backend only handles raw text translation, no format pre-processing or post-processing.
    """
    request_id = None
    try:
        data = await request.json()
        text = data.get("text")
        from_lang = data.get("from", "auto")
        to_lang = data.get("to", "zh")
        request_id = data.get("request_id")
        is_auto = data.get("is_auto", False)

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)
        
        # Preparation stage log
        # Language display name mapping
        lang_names = {
            "auto": "Auto detect", "zh": "Simplified Chinese", "en": "English", "zh-TW": "Traditional Chinese", 
            "ja": "Japanese", "ko": "Korean", "ar": "Arabic", "es": "Spanish", 
            "fa": "Persian", "fr": "French", "pt-BR": "Portuguese (Brazil)", "ru": "Russian", "tr": "Turkish"
        }
        from_lang_name = lang_names.get(from_lang, from_lang)
        to_lang_name = lang_names.get(to_lang, to_lang)
        log_prepare(TASK_TRANSLATE, request_id, SOURCE_FRONTEND, "Baidu Translate", None, None, {"direction": f"{from_lang_name}→{to_lang_name}", "length": len(text)})
        
        # Create and register task
        task = asyncio.create_task(BaiduTranslateService.translate(text, from_lang, to_lang, request_id, is_auto, task_type=TASK_TRANSLATE, source=SOURCE_FRONTEND))
        ACTIVE_TASKS[request_id] = task
        
        result = await task
        
        # Service layer already output error log, do not repeat here
        return web.json_response(result)
    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} Baidu Translate task cancelled | ID:{request_id}", flush=True)
        return web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Baidu Translate request exception | error:{error_msg}")
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]

@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/expand')
async def llm_expand(request):
    """LLM Expand API"""
    request_id = None
    try:
        data = await request.json()
        prompt = data.get("prompt")
        request_id = data.get("request_id")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        llm_config = config_manager.get_llm_config()
        if llm_config:
            provider = llm_config.get('provider', 'ollama')
            model = llm_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            # Check disable_thinking config
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            # Get rule name
            system_prompts = config_manager.get_system_prompts()
            rule_name = "Unknown rule"
            if system_prompts and 'expand_prompts' in system_prompts:
                active_prompt_id = system_prompts.get('active_prompts', {}).get('expand', 'expand_default')
                if active_prompt_id in system_prompts['expand_prompts']:
                    rule_name = system_prompts['expand_prompts'][active_prompt_id].get('name', active_prompt_id)
                elif len(system_prompts['expand_prompts']) > 0:
                    # If active ID does not exist, use first one
                    first_id = list(system_prompts['expand_prompts'].keys())[0]
                    rule_name = system_prompts['expand_prompts'][first_id].get('name', first_id)
            
            log_prepare(TASK_EXPAND, request_id, SOURCE_FRONTEND, provider_display, model_display, rule_name, {"length": len(prompt)})

        # Create and register task
        task = asyncio.create_task(LLMService.expand_prompt(prompt, request_id, task_type=TASK_EXPAND, source=SOURCE_FRONTEND))
        ACTIVE_TASKS[request_id] = task
        
        result = await task
        
        # Service layer already output error log, do not repeat here
        return web.json_response(result)
    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} LLM prompt optimization task cancelled | ID:{request_id}", flush=True)
        return web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} LLM prompt optimization request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]


@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/translate')
async def llm_translate(request):
    """LLM Translate API"""
    request_id = None
    try:
        data = await request.json()
        text = data.get("text")
        from_lang = data.get("from", "auto")
        to_lang = data.get("to", "zh")
        request_id = data.get("request_id")
        is_auto = data.get("is_auto", False)
        
        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        prefix = AUTO_TRANSLATE_REQUEST_PREFIX if is_auto else REQUEST_PREFIX
        # Language display name mapping
        lang_names = {
            "auto": "Auto detect", "zh": "Simplified Chinese", "en": "English", "zh-TW": "Traditional Chinese", 
            "ja": "Japanese", "ko": "Korean", "ar": "Arabic", "es": "Spanish", 
            "fa": "Persian", "fr": "French", "pt-BR": "Portuguese (Brazil)", "ru": "Russian", "tr": "Turkish"
        }
        from_lang_name = lang_names.get(from_lang, from_lang)
        to_lang_name = lang_names.get(to_lang, to_lang)
        
        # Use independent translate config
        translate_config = config_manager.get_translate_config()
        if translate_config:
            provider = translate_config.get('provider', 'baidu')
            model = translate_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            # Check disable_thinking config
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            log_prepare(TASK_TRANSLATE, request_id, SOURCE_FRONTEND, provider_display, model_display, None, {"direction": f"{from_lang_name}→{to_lang_name}", "length": len(text)})

        # Create and register task
        task = asyncio.create_task(LLMService.translate(
            text=text, 
            from_lang=from_lang, 
            to_lang=to_lang, 
            request_id=request_id, 
            custom_provider=provider if translate_config else None,
            custom_provider_config=translate_config,
            cancel_event=None,
            task_type=TASK_TRANSLATE,
            source=SOURCE_FRONTEND
        ))
        ACTIVE_TASKS[request_id] = task

        result = await task
        
        # Service layer already output error log, do not repeat here
        return web.json_response(result)
    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} LLM translate task cancelled | ID:{request_id}", flush=True)
        return web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} LLM translate request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]

@PromptServer.instance.routes.post(f'{API_PREFIX}/vlm/analyze')
async def vlm_analyze(request):
    """Vision Analysis API"""
    request_id = None
    try:
        data = await request.json()
        image_data = data.get("image")
        request_id = data.get("request_id")
        # Get prompt content from request, this is the key fix
        prompt_content = data.get("prompt")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        vision_config = config_manager.get_vision_config()
        if vision_config:
            provider = vision_config.get('provider', 'ollama')
            model = vision_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            # Check disable_thinking config
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            # Get rule name
            rule_name = "Default rule"
            if prompt_content:
                # If frontend passed custom prompt, try to match rule name
                system_prompts = config_manager.get_system_prompts()
                if system_prompts and 'vision_prompts' in system_prompts:
                    # Try to match from vision_prompts
                    for prompt_id, prompt_data in system_prompts['vision_prompts'].items():
                        if prompt_data.get('content') == prompt_content:
                            rule_name = prompt_data.get('name', prompt_id)
                            break
                    else:
                        # If no match found, it is custom
                        rule_name = "Custom rule"
            else:
                # Use active system prompt (need to detect language)
                # Simplified to get active Chinese rule, should actually detect based on prompt language
                system_prompts = config_manager.get_system_prompts()
                if system_prompts:
                    active_prompts = system_prompts.get('active_prompts', {})
                    # Prefer Chinese rule
                    active_prompt_id = active_prompts.get('vision_zh')
                    if active_prompt_id and 'vision_prompts' in system_prompts:
                        if active_prompt_id in system_prompts['vision_prompts']:
                            rule_name = system_prompts['vision_prompts'][active_prompt_id].get('name', active_prompt_id)
            
            log_prepare(TASK_IMAGE_CAPTION, request_id, SOURCE_FRONTEND, provider_display, model_display, rule_name)

        # Create and register task, using new interface signature
        task = asyncio.create_task(VisionService.analyze_image(
            image_data=image_data,
            request_id=request_id,
            prompt_content=prompt_content,
            task_type=TASK_IMAGE_CAPTION,
            source=SOURCE_FRONTEND
        ))
        ACTIVE_TASKS[request_id] = task

        result = await task

        # Service layer already output error log, do not repeat here
        return web.json_response(result)
    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} Vision analysis task cancelled | ID:{request_id}", flush=True)
        return web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Vision analysis request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]

# --- Streaming output API (SSE) ---

@PromptServer.instance.routes.post(f'{API_PREFIX}/vlm/analyze/stream')
async def vlm_analyze_stream(request):
    """
    Vision Analysis API (streaming version)
    Uses Server-Sent Events (SSE) to push analysis results token by token
    """
    request_id = None
    response = None
    try:
        data = await request.json()
        image_data = data.get("image")
        request_id = data.get("request_id")
        prompt_content = data.get("prompt")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        # Create SSE response
        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',  # Disable nginx buffering
            }
        )
        await response.prepare(request)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        vision_config = config_manager.get_vision_config()
        if vision_config:
            provider = vision_config.get('provider', 'ollama')
            model = vision_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            # Get rule name
            rule_name = "Default rule"
            if prompt_content:
                system_prompts = config_manager.get_system_prompts()
                if system_prompts and 'vision_prompts' in system_prompts:
                    for prompt_id, prompt_data in system_prompts['vision_prompts'].items():
                        if prompt_data.get('content') == prompt_content:
                            rule_name = prompt_data.get('name', prompt_id)
                            break
                    else:
                        rule_name = "Custom rule"
            
            log_prepare(TASK_IMAGE_CAPTION, request_id, SOURCE_FRONTEND, provider_display, model_display, rule_name)

        # For collecting full content
        full_content = []
        
        # Define streaming callback
        def stream_callback(chunk):
            full_content.append(chunk)
            # Send chunk as SSE event (sync version, handled by caller)
            return chunk

        # Create task
        async def run_analysis():
            return await VisionService.analyze_image(
                image_data=image_data,
                request_id=request_id,
                prompt_content=prompt_content,
                stream_callback=stream_callback,
                task_type=TASK_IMAGE_CAPTION,
                source=SOURCE_FRONTEND
            )

        task = asyncio.create_task(run_analysis())
        ACTIVE_TASKS[request_id] = task

        # Poll and send streaming content
        last_sent_index = 0
        while not task.done():
            # Send new chunks
            while last_sent_index < len(full_content):
                chunk = full_content[last_sent_index]
                sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
                await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
                last_sent_index += 1
            await asyncio.sleep(0.05)  # 50ms poll interval

        # Send remaining chunks
        while last_sent_index < len(full_content):
            chunk = full_content[last_sent_index]
            sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
            await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
            last_sent_index += 1

        # Get result
        result = await task
        
        # Send completion signal
        done_data = json.dumps({"done": True, "result": result}, ensure_ascii=False)
        await response.write(f"data: {done_data}\n\n".encode('utf-8'))
        
        await response.write_eof()
        return response

    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} Streaming vision analysis task cancelled | ID:{request_id}", flush=True)
        if response:
            error_data = json.dumps({"error": "Request cancelled", "cancelled": True}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
        return response if response else web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Streaming vision analysis request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        if response:
            error_data = json.dumps({"error": error_msg}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
            return response
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]

@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/expand/stream')
async def llm_expand_stream(request):
    """
    LLM Expand API (streaming version)
    Uses Server-Sent Events (SSE) to push expansion results token by token
    """
    request_id = None
    response = None
    try:
        data = await request.json()
        prompt = data.get("prompt")
        request_id = data.get("request_id")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        # Create SSE response
        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            }
        )
        await response.prepare(request)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        llm_config = config_manager.get_llm_config()
        if llm_config:
            provider = llm_config.get('provider', 'ollama')
            model = llm_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            # Get rule name
            system_prompts = config_manager.get_system_prompts()
            rule_name = "Unknown rule"
            if system_prompts and 'expand_prompts' in system_prompts:
                active_prompt_id = system_prompts.get('active_prompts', {}).get('expand', 'expand_default')
                if active_prompt_id in system_prompts['expand_prompts']:
                    rule_name = system_prompts['expand_prompts'][active_prompt_id].get('name', active_prompt_id)
                elif len(system_prompts['expand_prompts']) > 0:
                    first_id = list(system_prompts['expand_prompts'].keys())[0]
                    rule_name = system_prompts['expand_prompts'][first_id].get('name', first_id)
            
            log_prepare(TASK_EXPAND, request_id, SOURCE_FRONTEND, provider_display, model_display, rule_name, {"length": len(prompt)})

        # For collecting full content
        full_content = []
        
        # Define streaming callback
        def stream_callback(chunk):
            full_content.append(chunk)
            return chunk

        # Create task
        async def run_expand():
            return await LLMService.expand_prompt(
                prompt=prompt,
                request_id=request_id,
                stream_callback=stream_callback,
                task_type=TASK_EXPAND,
                source=SOURCE_FRONTEND
            )

        task = asyncio.create_task(run_expand())
        ACTIVE_TASKS[request_id] = task

        # Poll and send streaming content
        last_sent_index = 0
        while not task.done():
            while last_sent_index < len(full_content):
                chunk = full_content[last_sent_index]
                sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
                await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
                last_sent_index += 1
            await asyncio.sleep(0.05)

        # Send remaining chunks
        while last_sent_index < len(full_content):
            chunk = full_content[last_sent_index]
            sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
            await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
            last_sent_index += 1

        # Get result
        result = await task
        
        # Send completion signal
        done_data = json.dumps({"done": True, "result": result}, ensure_ascii=False)
        await response.write(f"data: {done_data}\n\n".encode('utf-8'))
        
        await response.write_eof()
        return response

    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} Streaming LLM expand task cancelled | ID:{request_id}", flush=True)
        if response:
            error_data = json.dumps({"error": "Request cancelled", "cancelled": True}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
        return response if response else web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Streaming LLM expand request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        if response:
            error_data = json.dumps({"error": error_msg}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
            return response
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]
@PromptServer.instance.routes.post(f'{API_PREFIX}/llm/translate/stream')
async def llm_translate_stream(request):
    """
    LLM Translate API (streaming version)
    Uses Server-Sent Events (SSE) to push translation results token by token
    Note: Only supports LLM translation, Baidu Translate does not support streaming, use original interface
    """
    request_id = None
    response = None
    try:
        data = await request.json()
        text = data.get("text")
        from_lang = data.get("from", "auto")
        to_lang = data.get("to", "zh")
        request_id = data.get("request_id")

        if not request_id:
            return web.json_response({"success": False, "error": "Missing request_id"}, status=400)

        if not text or text.strip() == '':
            return web.json_response({"success": False, "error": "Missing translation text"}, status=400)

        # Create SSE response
        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            }
        )
        await response.prepare(request)

        # Preparation stage log
        from .services.thinking_control import build_thinking_suppression
        from .utils.common import format_model_with_thinking
        from .services.openai_base import OpenAICompatibleService
        
        # Use translate service config (not LLM config)
        translate_config = config_manager.get_translate_config()
        if translate_config:
            provider = translate_config.get('provider', 'ollama')
            model = translate_config.get('model', '')
            provider_display = OpenAICompatibleService.get_provider_display_name(provider)
            
            service = config_manager.get_service(provider)
            disable_thinking_enabled = service.get('disable_thinking', True) if service else True
            
            thinking_extra = build_thinking_suppression(provider, model) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model, bool(thinking_extra))
            
            log_prepare(TASK_TRANSLATE, request_id, SOURCE_FRONTEND, provider_display, model_display, f"{from_lang}→{to_lang}", {"length": len(text)})

        # For collecting full content
        full_content = []
        
        # Define streaming callback
        def stream_callback(chunk):
            full_content.append(chunk)
            return chunk

        # Create task
        async def run_translate():
            return await LLMService.translate(
                text=text,
                from_lang=from_lang,
                to_lang=to_lang,
                request_id=request_id,
                stream_callback=stream_callback,
                task_type=TASK_TRANSLATE,
                source=SOURCE_FRONTEND
            )

        task = asyncio.create_task(run_translate())
        ACTIVE_TASKS[request_id] = task

        # Poll and send streaming content
        last_sent_index = 0
        while not task.done():
            while last_sent_index < len(full_content):
                chunk = full_content[last_sent_index]
                sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
                await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
                last_sent_index += 1
            await asyncio.sleep(0.05)

        # Send remaining chunks
        while last_sent_index < len(full_content):
            chunk = full_content[last_sent_index]
            sse_data = json.dumps({"chunk": chunk}, ensure_ascii=False)
            await response.write(f"data: {sse_data}\n\n".encode('utf-8'))
            last_sent_index += 1

        # Get result
        result = await task
        
        # Send completion signal
        done_data = json.dumps({"done": True, "result": result}, ensure_ascii=False)
        await response.write(f"data: {done_data}\n\n".encode('utf-8'))
        
        await response.write_eof()
        return response

    except asyncio.CancelledError:
        print(f"\r{_ANSI_CLEAR_EOL}{WARN_PREFIX} Streaming LLM translate task cancelled | ID:{request_id}", flush=True)
        if response:
            error_data = json.dumps({"error": "Request cancelled", "cancelled": True}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
        return response if response else web.json_response({"success": False, "error": "Request cancelled", "cancelled": True}, status=400)
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Streaming LLM translate request exception | requestID:{request_id if request_id else 'unknown'} | error:{error_msg}")
        if response:
            error_data = json.dumps({"error": error_msg}, ensure_ascii=False)
            await response.write(f"data: {error_data}\n\n".encode('utf-8'))
            await response.write_eof()
            return response
        return web.json_response({"success": False, "error": error_msg})
    finally:
        if request_id and request_id in ACTIVE_TASKS:
            del ACTIVE_TASKS[request_id]


@PromptServer.instance.routes.post(f'{API_PREFIX}/video/info')
async def get_video_info(request):
    """Get video file info (FPS, duration, etc.)"""
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        type_ = data.get("type", "input")
        
        if not filename:
            return web.json_response({"success": False, "error": "Missing filename parameter"}, status=400)

        # Get full file path
        file_path = None
        
        # 1. Try as absolute path directly
        if os.path.exists(filename):
            file_path = filename
        else:
            # 2. Use ComfyUI path resolution
            file_path = folder_paths.get_annotated_filepath(filename)
        
        if not file_path or not os.path.exists(file_path):
            # 3. Try to find in input directory
            input_dir = folder_paths.get_input_directory()
            possible_path = os.path.join(input_dir, filename)
            if os.path.exists(possible_path):
                file_path = possible_path
        
        if not file_path or not os.path.exists(file_path):
            return web.json_response({"success": False, "error": "Video file not found"}, status=404)

        # Read metadata
        info_result = get_video_frame_info(file_path)
        if info_result["success"]:
            return web.json_response({
                "success": True,
                "fps": info_result["original_fps"],
                "duration": info_result["duration"],
                "total_frames": info_result["original_total_frames"],
                "path": file_path
            })
        else:
            return web.json_response({"success": False, "error": f"Failed to read video metadata: {info_result.get('error')}"}, status=500)
            
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=500)

@PromptServer.instance.routes.post(f'{API_PREFIX}/models/list')
async def get_models_list(request):
    """
    Get model list API
    Request parameters:
    - provider: Service provider (zhipu, siliconflow, 302ai, ollama, custom)
    - model_type: Model type ('llm' or 'vision')
    - recommended: Whether to get recommended list (optional, default False)
    """
    try:
        data = await request.json()
        provider = data.get("provider")
        model_type = data.get("model_type", "llm")
        recommended = data.get("recommended", False)
        
        if not provider:
            return web.json_response({
                "success": False,
                "error": "Missing provider parameter"
            }, status=400)
        
        # If requesting recommended model list, return static list directly
        if recommended:
            result = ModelListService.get_recommended_models(provider, model_type)
            return web.json_response(result)
        
        # Get API Key for corresponding provider from config
        if model_type == 'llm':
            config = config_manager.get_llm_config()
        else:
            config = config_manager.get_vision_config()
        
        # Get configuration for corresponding provider
        providers_config = config.get('providers', {})
        provider_config = providers_config.get(provider, {})
        api_key = provider_config.get('api_key', '')
        base_url = provider_config.get('base_url', '')
        
        # Call model list service
        result = ModelListService.get_models(provider, api_key, model_type, base_url)
        
        return web.json_response(result)
        
    except Exception as e:
        error_msg = str(e)
        print(f"{ERROR_PREFIX} Get model list exception | error:{error_msg}")
        return web.json_response({
            "success": False,
            "error": error_msg
        }, status=500) 

# --- Video frame extraction API ---

@PromptServer.instance.routes.post(f'{API_PREFIX}/video/frame')
async def get_video_frame(request):
    """
    Get image of specified video frame
    
    Request parameters:
        filename: Video filename
        frame_index: Frame index (based on frame sequence after force_rate)
        force_rate: Forced frame rate (optional, 0 means original frame rate)
        type: File type (input/output, default input)
    
    Returns:
        success: Whether successful
        data: Base64 encoded JPEG image
        width/height: Image dimensions
    """
    try:
        data = await request.json()
        filename = data.get("filename")
        frame_index = data.get("frame_index", 0)
        force_rate = data.get("force_rate", 0)
        type_ = data.get("type", "input")
        
        if not filename:
            return web.json_response({"success": False, "error": "Missing filename parameter"}, status=400)
        
        # Get full file path
        file_path = None
        
        # 1. Try as absolute path directly
        if os.path.exists(filename):
            file_path = filename
        else:
            # 2. Use ComfyUI path resolution
            file_path = folder_paths.get_annotated_filepath(filename)
        
        if not file_path or not os.path.exists(file_path):
            # 3. Try to find in input directory
            input_dir = folder_paths.get_input_directory()
            possible_path = os.path.join(input_dir, filename)
            if os.path.exists(possible_path):
                file_path = possible_path
        
        if not file_path or not os.path.exists(file_path):
            return web.json_response({"success": False, "error": "Video file not found"}, status=404)
        
        # Call frame extraction function
        result = extract_frame_by_index(file_path, frame_index, force_rate)
        
        if result["success"]:
            return web.json_response(result)
        else:
            return web.json_response(result, status=500)
            
    except Exception as e:
        print(f"{ERROR_PREFIX} Frame extraction failed | error:{str(e)}")
        return web.json_response({"success": False, "error": str(e)}, status=500)
