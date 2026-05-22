"""
提示词内容提取预设节点 - V3 版本
"""

import hashlib
from typing import Dict, Any

from comfy_api.latest import io
from .base.base_node import BaseNode


class KontextPresetNode(BaseNode, io.ComfyNode):
    """
    提示词内容提取预设节点（V3）
    允许用户选择一个 KonText（上下文），读取其配置并格式化输出预设的系统提示词，
    将选定的参数组（包含模型和温度）也输出，作为后续节点的强制输入参数。
    """
    
    # 静态缓存
    _cached_config: Dict[str, Any] = {}
    
    @classmethod
    def _load_config(cls) -> Dict[str, Any]:
        """按需获取配置，V3由于有类方法缓存机制，依然可以使用"""
        from ..config_manager import config_manager
        
        config = config_manager.get_system_prompts()
        if not config:
            return {}
            
        return config

    @classmethod
    def define_schema(cls):
        config = cls._load_config()
        kontext_options = []
        
        # 解析可用的 kontext 选项
        if config and "kontexts" in config:
            for kontext in config["kontexts"]:
                kontext_options.append(kontext["name"])
                
        if not kontext_options:
            kontext_options = ["Default Extract Preset"]
            
        return io.Schema(
            node_id="KontextPresetNode",
            display_name="✨KonText Extractor",
            category="✨Prompt Assistant",
            description="Extract and format prompt templates from a selected KonText",
            inputs=[
                io.Combo.Input(
                    "kontext",
                    options=kontext_options,
                    default=kontext_options[0] if kontext_options else None,
                    tooltip="Choose a KonText preset to extract and format",
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