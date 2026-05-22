import os
import re
import logging
from . import server

from comfy_api.latest import io, ComfyExtension

# 导入所有重构后的 V3 节点
from .node.translate_node import PromptTranslate
from .node.image_caption_node import ImageCaptionNode
from .node.kontext_preset_node import KontextPresetNode
from .node.expand_node import PromptExpand
from .node.video_caption_node import VideoCaptionNode

WEB_DIRECTORY = "./js"

def get_version():
    """
    从pyproject.toml文件中读取版本号
    """
    try:
        toml_path = os.path.join(os.path.dirname(__file__), "pyproject.toml")
        with open(toml_path, "r", encoding='utf-8') as f:
            content = f.read()
            version_match = re.search(r'version\s*=\s*"([^"]+)"', content)
            if version_match:
                return version_match.group(1)
            raise ValueError("未在pyproject.toml中找到版本号")
    except Exception as e:
        print(f"读取版本号失败: {str(e)}")
        raise

def inject_version_to_frontend():
    """
    将版本号注入到前端全局变量
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

# 初始化版本号
VERSION = get_version()

# 执行初始化操作
inject_version_to_frontend()

# 禁用httpx的详细日志，避免打断单行动态显示
logging.getLogger("httpx").setLevel(logging.WARNING)

# 打印初始化信息
print(f"✨提示词小助手 V{VERSION} 已启动")

# =========================================================================
# ComfyUI V3 API 扩展注册机制
# =========================================================================

class PromptAssistantExtension(ComfyExtension):
    """
    Prompt Assistant 组件的扩展类
    通过 get_node_list 方法向系统注册所有 V3 节点
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
    V3 模块的入口函数，由 ComfyUI 启动时自动调用
    替代了旧的 NODE_CLASS_MAPPINGS 和 NODE_DISPLAY_NAME_MAPPINGS
    """
    return PromptAssistantExtension()
