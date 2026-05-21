import os
import re
import logging
from . import server

from comfy_api.latest import io, ComfyExtension

# Import all refactored V3 nodes
from .node.translate_node import PromptTranslate
from .node.image_caption_node import ImageCaptionNode
from .node.kontext_preset_node import KontextPresetNode
from .node.expand_node import PromptExpand
from .node.video_caption_node import VideoCaptionNode

WEB_DIRECTORY = "./js"

def get_version():
    """
    Read version number from pyproject.toml
    """
    try:
        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding='utf-8') as f:
            content = f.read()
            version_match = re.search(r'version\s*=\s*"([^"]+)"', content)
            if version_match:
                return version_match.group(1)
            raise ValueError("Version number not found in pyproject.toml")
    except Exception as e:
        print(f"Failed to read version: {str(e)}")
        raise

def inject_version_to_frontend():
    """
    Inject version number into frontend global variable
    """
    js_code = f"""
window.PromptAssistant_Version = "{VERSION}";
    """
    
    js_dir = os.path.join(os.path.dirname(__file__), "js")
    if not os.path.exists(js_dir):
        os.makedirs(js_dir)
    
    version_file = os.path.join(js_dir, "version.js")
    with open(version_file, "w", encoding='utf-8') as f:
        f.write(js_code)

# Initialize version number
VERSION = get_version()

# Execute initialization
inject_version_to_frontend()

# Disable httpx verbose logging to avoid interrupting single-line dynamic display
logging.getLogger("httpx").setLevel(logging.WARNING)

# Print initialization info
print(f"✨Prompt Assistant V{VERSION} started")

# =========================================================================
# ComfyUI V3 API Extension Registration Mechanism
# =========================================================================

class PromptAssistantExtension(ComfyExtension):
    """
    Extension class for Prompt Assistant component
    Registers all V3 nodes with the system via get_node_list
    """
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            ImageCaptionNode,
            KontextPresetNode,
            PromptTranslate,
            PromptExpand,
            VideoCaptionNode,
        ]

async def comfy_entrypoint() -> PromptAssistantExtension:
    """
    Entry point function for V3 module, automatically called by ComfyUI on startup
    Replaces the old NODE_CLASS_MAPPINGS and NODE_DISPLAY_NAME_MAPPINGS
    """
    return PromptAssistantExtension()
