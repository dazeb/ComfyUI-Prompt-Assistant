"""
Prompt content extraction preset node - V3 version
"""

import hashlib
from typing import Dict, Any

from comfy_api.latest import io
from .base.base_node import BaseNode


class KontextPresetNode(BaseNode, io.ComfyNode):
    """
    Prompt content extraction preset node (V3)
    Allows the user to select a KonText, read its configuration and format output
    as the preset system prompt, also outputting the selected parameter group
    (including model and temperature) as mandatory input parameters for subsequent nodes.
    """
    
    # Static cache
    _cached_config: Dict[str, Any] = {}
    
    @classmethod
    def _load_config(cls) -> Dict[str, Any]:
        """Load config on demand, still usable with V3 class method caching mechanism"""
        from ..config_manager import config_manager
        
        config = config_manager.get_system_prompts()
        if not config:
            return {}
            
        return config

    @classmethod
    def define_schema(cls):
        config = cls._load_config()
        kontext_options = []
        
        # Parse available kontext options
        if config and "kontexts" in config:
            for kontext in config["kontexts"]:
                kontext_options.append(kontext["name"])
                
        if not kontext_options:
            kontext_options = ["Default Extraction Preset"]
            
        return io.Schema(
            node_id="KontextPresetNode",
            display_name="✨KonText Extractor",
            category="✨Prompt Assistant",
            description="Extract and format prompt templates from a selected KonText",
            inputs=[
                io.Combo.Input(
                    "kontext",
                    options=kontext_options,
                    default=kontext_options[0] if kontext_options else None
                ),
            ],
            outputs=[
                io.String.Output("system_prompt"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, kontext=None):
        return hash((kontext,))

    @classmethod
    def execute(cls, kontext):
        config = cls._load_config()
        system_prompt = ""
        
        if config and "kontexts" in config:
            for k in config["kontexts"]:
                if k["name"] == kontext:
                    system_prompt = k.get("prompt", "")
                    break
                    
        return io.NodeOutput(system_prompt)
