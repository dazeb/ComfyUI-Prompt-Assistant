"""
Prompt enhancement node - V3 version

V3 Migration Notes:
    - Inherits LLMNodeBase (tool base class Mixin) + io.ComfyNode (V3 node base class)
    - INPUT_TYPES -> define_schema(), returns io.Schema
    - IS_CHANGED -> fingerprint_inputs()
    - def enhance(self, ...) -> @classmethod execute(cls, ...)
    - Returns io.NodeOutput(val) instead of (val,)
    - hidden unique_id accessed via cls.hidden.unique_id
    - NODE_CLASS_MAPPINGS no longer exported, registered uniformly by ComfyExtension in top-level __init__.py
"""

import hashlib

from comfy.model_management import InterruptProcessingException
from comfy_api.latest import io

from ..services.llm import LLMService
from ..utils.common import (
    format_api_error, format_model_with_thinking, generate_request_id,
    log_prepare, log_error, TASK_EXPAND, SOURCE_NODE
)
from ..services.thinking_control import build_thinking_suppression
from .base import LLMNodeBase


class PromptExpand(LLMNodeBase, io.ComfyNode):
    """
    Prompt enhancement node (V3)
    - Input "source_text", enhanced/expanded based on selected rule template or custom rule
    - Contains only one string input and one string output
    """

    @classmethod
    def define_schema(cls):
        """Define node Schema (V3 replaces INPUT_TYPES + class attributes)"""
        # Get system prompt configuration from config_manager
        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        # Get all expand_prompts as dropdown options
        expand_prompts = {}
        active_expand_id = None
        if system_prompts:
            expand_prompts = system_prompts.get('expand_prompts', {}) or {}
            active_expand_id = system_prompts.get('active_prompts', {}).get('expand')

        # Build prompt template options (supports category format: category/rule_name)
        prompt_template_options = []
        id_to_display_name = {}
        for key, value in expand_prompts.items():
            # Filter out rules not shown in backend
            show_in = value.get('showIn', ["frontend", "node"])
            if 'node' not in show_in:
                continue
            name = value.get('name', key)
            category = value.get('category', '')
            display_name = f"{category}/{name}" if category else name
            id_to_display_name[key] = display_name
            prompt_template_options.append(display_name)

        # Default option fallback
        default_template_name = prompt_template_options[0] if prompt_template_options else "Expand-Natural Language"
        if active_expand_id and active_expand_id in id_to_display_name:
            default_template_name = id_to_display_name[active_expand_id]

        if not prompt_template_options:
            prompt_template_options = ["Expand-Natural Language"]

        # ---Dynamically get LLM service/model list---
        service_options = cls.get_llm_service_options()
        default_service = service_options[0] if service_options else "Zhipu"

        return io.Schema(
            node_id="PromptExpand",
            display_name="✨Prompt Enhance",
            category="✨Prompt Assistant",
            description="Enhance and expand prompts using LLM services",
            inputs=[
                # Rule template: all expand rules from system config
                io.Combo.Input(
                    "rule",
                    options=prompt_template_options,
                    default=default_template_name,
                    tooltip="Choose a preset rule for prompt enhancement",
                ),
                # Custom rule toggle
                io.Boolean.Input(
                    "custom_rule",
                    default=False,
                    label_on="Enable",
                    label_off="Disable",
                    tooltip="Enable to use custom rule content below instead of preset",
                ),
                # Custom rule content input
                io.String.Input(
                    "custom_rule_content",
                    multiline=True,
                    default="",
                    placeholder="Enter custom rule here, only effective when 'Custom Rule' is enabled",
                    tooltip="Enter your custom rule content here",
                ),
                # User prompt
                io.String.Input(
                    "user_prompt",
                    multiline=True,
                    default="",
                    placeholder="Enter the prompt to enhance; if source_text is also connected, both will be merged",
                    tooltip="The original prompt to enhance",
                ),
                # Expand service
                io.Combo.Input(
                    "llm_service",
                    options=service_options,
                    default=default_service,
                    tooltip="Select LLM service and model",
                ),
                # Ollama auto free VRAM
                io.Boolean.Input(
                    "ollama_auto_unload",
                    default=True,
                    label_on="Enable",
                    label_off="Disable",
                    tooltip="Auto unload Ollama model after generation",
                ),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xffffffffffffffff,
                    control_after_generate=True,
                ),
                # Source text input port (optional), default is connected port
                io.String.Input(
                    "source_text",
                    optional=True,
                    multiline=True,
                    default="",
                    force_input=True,
                    placeholder="Input text to enhance...",
                    tooltip="Optional input text",
                ),
            ],
            outputs=[
                io.String.Output("enhanced_text"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def fingerprint_inputs(
        cls,
        rule=None, custom_rule=None, custom_rule_content=None,
        user_prompt=None, llm_service=None, ollama_auto_unload=None,
        seed=None, source_text=None
    ):
        """
        Replaces V1 IS_CHANGED, only triggers re-execution when input content actually changes
        Uses hash of input parameters as the basis for judgment
        """
        text_hash = hashlib.md5(((source_text or "")).encode('utf-8')).hexdigest()
        temp_rule_hash = hashlib.md5((custom_rule_content or "").encode('utf-8')).hexdigest()
        user_hint_hash = hashlib.md5((user_prompt or "").encode('utf-8')).hexdigest()

        input_hash = hash((
            rule,
            bool(custom_rule),
            temp_rule_hash,
            user_hint_hash,
            llm_service,
            bool(ollama_auto_unload),
            seed,
            text_hash,
        ))
        return input_hash

    @classmethod
    def execute(
        cls,
        rule, custom_rule, custom_rule_content, user_prompt,
        llm_service, ollama_auto_unload, seed=None, source_text=None
    ):
        """
        Enhance/expand text function (V3 classmethod version)
        Access node unique ID via cls.hidden.unique_id
        """
        # Get node unique ID from cls.hidden
        unique_id = cls.hidden.unique_id
        request_id = None

        try:
            # Allow empty source_text, but at least one of source_text and user_prompt must be non-empty
            source_text = (source_text or "").strip()
            user_prompt = (user_prompt or "").strip()
            if not source_text and not user_prompt:
                return io.NodeOutput("")

            # ---Prepare system prompt (rule)---
            system_message = None
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule

            if custom_rule and custom_rule_content:
                # Use custom rule
                system_message = {"role": "system", "content": custom_rule_content}
            else:
                # Use template: get system prompt config from config_manager
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                expand_prompts = system_prompts.get('expand_prompts', {}) if system_prompts else {}

                # Find selected prompt template (match by display name)
                template_found = False
                for key, value in expand_prompts.items():
                    name = value.get('name', key)
                    category = value.get('category', '')
                    display_name = f"{category}/{name}" if category else name
                    if display_name == rule:
                        system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                        template_found = True
                        break
                if not template_found:
                    # Allow direct match by rule name or key name (compatible with old format)
                    for key, value in expand_prompts.items():
                        if value.get('name') == rule or key == rule:
                            system_message = {"role": value.get('role', 'system'), "content": value.get('content', '')}
                            template_found = True
                            break
                if not template_found or not system_message or not system_message.get('content'):
                    # Fallback to default
                    system_message = {"role": "system", "content": "You are a prompt expansion expert. Please expand the given text into a more complete, readable, and actionable prompt."}
                    rule_name = "Default Rule"

            # ---Parse service/model string---
            service_id, model_name = cls.parse_service_model(llm_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {llm_service}")

            # ---Get service configuration---
            from ..config_manager import config_manager
            service = config_manager.get_service(service_id)
            if not service:
                raise ValueError(f"Service config not found: {llm_service}")

            # ---Build provider_config---
            llm_models = service.get('llm_models', [])
            target_model = None

            if model_name:
                target_model = next((m for m in llm_models if m.get('name') == model_name), None)

            if not target_model:
                target_model = next(
                    (m for m in llm_models if m.get('is_default')),
                    llm_models[0] if llm_models else None
                )

            if not target_model:
                raise ValueError(f"Service {llm_service} has no available models")

            provider_config = {
                'provider': service_id,
                'model': target_model.get('name', ''),
                'base_url': service.get('base_url', ''),
                'api_key': service.get('api_key', ''),
                'temperature': target_model.get('temperature', 0.7),
                'max_tokens': target_model.get('max_tokens', 1000),
                'top_p': target_model.get('top_p', 0.9),
            }

            # Ollama special handling: add auto_unload config
            if service.get('type') == 'ollama':
                provider_config['auto_unload'] = ollama_auto_unload

            # Generate request ID
            request_id = generate_request_id("exp", None, unique_id)

            # Merge source text and user prompt (input port takes precedence, node text box follows)
            combined_text = (
                user_prompt if not source_text
                else (f"{source_text}\n\n{user_prompt}" if user_prompt else source_text)
            )

            # Check if thinking chain is disabled
            model_full_name = provider_config.get('model')
            disable_thinking_enabled = service.get('disable_thinking', True)
            thinking_extra = build_thinking_suppression(service_id, model_full_name) if disable_thinking_enabled else None
            model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))

            # Get service display name
            service_display_name = service.get('name', service_id)

            # Preparation phase log
            log_prepare(TASK_EXPAND, request_id, SOURCE_NODE, service_display_name, model_display, rule_name, {"Length": len(combined_text)})

            # Check API key and model
            if not provider_config.get('model', ''):
                raise ValueError(f"Please configure model for {llm_service}")
            if cls._service_requires_api_key(service) and not provider_config.get('api_key', ''):
                raise ValueError(f"Please configure API key and model for {llm_service}")

            # Execute expansion (async thread + interruptible)
            result = cls._run_llm_task(
                LLMService.expand_prompt,
                service_id,
                prompt=combined_text,
                request_id=request_id,
                stream_callback=None,
                custom_provider=service_id,
                custom_provider_config=provider_config,
                system_message_override=system_message,
                task_type=TASK_EXPAND,
                source=SOURCE_NODE
            )

            if result and result.get('success'):
                expanded_text = result.get('data', {}).get('expanded', '').strip()
                if not expanded_text:
                    error_msg = 'API returned empty result'
                    log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
                    raise RuntimeError(f"Enhancement failed: {error_msg}")
                # Result phase log is output uniformly by service layer, node layer no longer repeats
                return io.NodeOutput(expanded_text)
            else:
                error_msg = result.get('error', 'Unknown error') if result else 'No result returned'
                if error_msg == "Task interrupted":
                    raise InterruptProcessingException()
                log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"Enhancement failed: {error_msg}")

        except InterruptProcessingException:
            # Don't print log, base class prints uniformly
            raise
        except Exception as e:
            error_msg = format_api_error(e, llm_service)
            log_error(TASK_EXPAND, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Enhancement error: {error_msg}")
