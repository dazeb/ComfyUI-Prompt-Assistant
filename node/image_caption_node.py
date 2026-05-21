"""
Image captioning (image-to-prompt reverse inference) node - V3 version

V3 Migration Notes:
    - Inherits VLMNodeBase + io.ComfyNode
    - INPUT_TYPES -> define_schema()
    - IS_CHANGED -> fingerprint_inputs()
    - def analyze_image(self, ...) -> @classmethod execute(cls, ...)

Feature Description:
    - Supports single image input
    - Supports IMAGE batch input: processes each frame independently via VLM, outputs merged text + string list
    - Two output ports:
        · caption_text  (STRING)      - All frame results merged with "\\n---\\n" into complete text
        · caption_list  (STRING List) - Independent result string list per frame (is_output_list=True)
"""

from comfy.model_management import InterruptProcessingException
from comfy_api.latest import io

from ..services.vlm import VisionService
from ..utils.common import (
    format_api_error, format_model_with_thinking, generate_request_id,
    log_prepare, log_error, TASK_IMAGE_CAPTION, SOURCE_NODE
)
from ..services.thinking_control import build_thinking_suppression
from .base import VLMNodeBase


class ImageCaptionNode(VLMNodeBase, io.ComfyNode):
    """Image captioning node (V3), supports single/batch image input, outputs merged text and string list"""

    @classmethod
    def define_schema(cls):
        # Dynamically get service list
        service_options = cls.get_vlm_service_options()
        default_service = service_options[0] if service_options else "Zhipu"

        # Get templates
        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        vision_prompts = {}
        active_vision_id = None
        if system_prompts:
            vision_prompts = system_prompts.get('vision_prompts', {}) or {}
            active_vision_id = system_prompts.get('active_prompts', {}).get('vision')

        prompt_template_options = []
        id_to_display_name = {}
        for key, value in vision_prompts.items():
            show_in = value.get('showIn', ["frontend", "node"])
            if 'node' not in show_in:
                continue
            name = value.get('name', key)
            category = value.get('category', '')
            display_name = f"{category}/{name}" if category else name
            id_to_display_name[key] = display_name
            prompt_template_options.append(display_name)

        default_template_name = prompt_template_options[0] if prompt_template_options else "Caption-Natural Language"
        if active_vision_id and active_vision_id in id_to_display_name:
            default_template_name = id_to_display_name[active_vision_id]

        if not prompt_template_options:
            prompt_template_options = ["Caption-Natural Language"]

        return io.Schema(
            node_id="ImageCaptionNode",
            display_name="✨Image Caption (VLM)",
            category="✨Prompt Assistant",
            description="Extract text prompt from image using Vision-Language Models",
            inputs=[
                io.Image.Input(
                    "image",
                    tooltip="The image to analyze. Supports single image or IMAGE batch (processes each frame independently)"
                ),
                io.Combo.Input(
                    "rule",
                    options=prompt_template_options,
                    default=default_template_name,
                    tooltip="Choose a preset rule for analysis"
                ),
                io.Boolean.Input(
                    "custom_rule",
                    default=False,
                    label_on="Enable",
                    label_off="Disable",
                    tooltip="Enable custom rule input"
                ),
                io.String.Input(
                    "custom_rule_content",
                    multiline=True,
                    default="",
                    tooltip="Custom rule content, only used when Custom Rule is enabled"
                ),
                io.String.Input(
                    "user_prompt",
                    multiline=True,
                    default="",
                    tooltip="Enter additional prompts here, sent with the rule"
                ),
                io.Combo.Input(
                    "vlm_service",
                    options=service_options,
                    default=default_service,
                    tooltip="Select VLM Service"
                ),
                io.Boolean.Input(
                    "ollama_auto_unload",
                    default=True,
                    label_on="Enable",
                    label_off="Disable",
                    tooltip="Auto unload Ollama model after generation"
                ),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xffffffffffffffff,
                    control_after_generate=True,
                    tooltip="Controls randomness. Set to non-fixed mode to force re-execution"
                ),
            ],
            outputs=[
                # Merged text (single image: direct output; batch: joined with "\\n---\\n")
                io.String.Output("caption_text"),
                # Per-frame independent result list (single image: single-element list)
                io.String.Output("caption_list", is_output_list=True),
            ],
            hidden=[io.Hidden.unique_id],
        )

    # -------------------------------------------------------------------------
    # fingerprint_inputs (replaces IS_CHANGED)
    # -------------------------------------------------------------------------

    @classmethod
    def fingerprint_inputs(
        cls,
        image=None, rule=None, custom_rule=None, custom_rule_content=None,
        user_prompt=None, vlm_service=None, ollama_auto_unload=None, seed=None
    ):
        """Replaces V1 IS_CHANGED"""
        import hashlib
        temp_rule_hash = hashlib.md5((custom_rule_content or "").encode('utf-8')).hexdigest()
        user_hint_hash = hashlib.md5((user_prompt or "").encode('utf-8')).hexdigest()
        img_hash = cls._compute_image_hash(image)

        return hash((
            img_hash,
            rule,
            bool(custom_rule),
            temp_rule_hash,
            user_hint_hash,
            vlm_service,
            bool(ollama_auto_unload),
            seed
        ))

    # -------------------------------------------------------------------------
    # Internal helper: analyze single image
    # -------------------------------------------------------------------------

    @classmethod
    def _analyze_single_image(
        cls,
        image_data: str,
        prompt_to_send: str,
        rule_name: str,
        service_id: str,
        service: dict,
        provider_config: dict,
        request_id: str,
        frame_index=None
    ) -> str:
        """
        Call VLM to analyze a single image and return text result.

        Args:
            image_data    : Base64 encoded image data URL
            prompt_to_send: Concatenated prompt (system + user_prompt)
            rule_name     : Current rule name (for logging)
            service_id    : Service ID
            service       : Service config dict
            provider_config: API call parameter dict
            request_id    : Current request ID
            frame_index   : Current frame index in batch mode (None for single image mode)

        Returns:
            Analysis result text string
        """
        frame_label = f" [Frame {frame_index + 1}]" if frame_index is not None else ""
        model_full_name = provider_config.get('model')
        disable_thinking_enabled = service.get('disable_thinking', True)
        thinking_extra = (
            build_thinking_suppression(service_id, model_full_name)
            if disable_thinking_enabled else None
        )
        model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
        service_display_name = service.get('name', service_id)

        log_prepare(
            TASK_IMAGE_CAPTION, request_id, SOURCE_NODE,
            service_display_name, model_display, rule_name + frame_label
        )

        result = cls._run_vision_task(
            VisionService.analyze_image,
            service_id,
            image_data=image_data,
            prompt_content=prompt_to_send,
            request_id=request_id,
            custom_provider=service_id,
            custom_provider_config=provider_config,
            source=SOURCE_NODE
        )

        if result and result.get('success'):
            data = result.get('data', {})
            # V3 refactoring returns key named description, compatible with old caption
            caption_text = data.get('description', data.get('caption', '')).strip()
            if not caption_text:
                error_msg = 'API returned empty result'
                log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"Analysis failed: {error_msg}")
            return caption_text
        else:
            error_msg = (
                result.get('error', 'Unknown error') if result
                else 'No result returned'
            )
            if error_msg == "Task interrupted":
                raise InterruptProcessingException()
            log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Analysis failed: {error_msg}")

    # -------------------------------------------------------------------------
    # execute (V3 main execution method)
    # -------------------------------------------------------------------------

    @classmethod
    def execute(
        cls,
        image, rule, custom_rule, custom_rule_content,
        user_prompt, vlm_service, ollama_auto_unload, seed=None
    ):
        unique_id = cls.hidden.unique_id
        request_id = None

        try:
            if image is None:
                raise ValueError("No image provided. Please connect an image to the 'image' input.")

            # ------------------------------------------------------------------
            # 1. Build prompt
            # ------------------------------------------------------------------
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule
            system_message = None

            if custom_rule and custom_rule_content:
                system_message = {"role": "system", "content": custom_rule_content}
            else:
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                vision_prompts = system_prompts.get('vision_prompts', {}) if system_prompts else {}

                template_found = False
                for key, value in vision_prompts.items():
                    name = value.get('name', key)
                    category = value.get('category', '')
                    display_name = f"{category}/{name}" if category else name
                    if display_name == rule or value.get('name') == rule or key == rule:
                        system_message = {
                            "role": value.get('role', 'system'),
                            "content": value.get('content', '')
                        }
                        template_found = True
                        break

                if not template_found or not system_message or not system_message.get('content'):
                    system_message = {"role": "system", "content": "Please describe this image in detail."}
                    rule_name = "Default Rule"

            system_text = (
                system_message.get('content', '')
                if isinstance(system_message, dict)
                else str(system_message)
            )
            prompt_to_send = f"{system_text}\n\n{user_prompt}".strip() if user_prompt else system_text

            # ------------------------------------------------------------------
            # 2. Parse service and model
            # ------------------------------------------------------------------
            service_id, model_name = cls.parse_service_model(vlm_service)
            if not service_id:
                raise ValueError(f"Invalid service selection: {vlm_service}")

            from ..config_manager import config_manager
            service = config_manager.get_service(service_id)
            if not service:
                raise ValueError(f"Service config not found: {vlm_service}")

            vlm_models = service.get('vlm_models', [])
            target_model = None
            if model_name:
                target_model = next((m for m in vlm_models if m.get('name') == model_name), None)
            if not target_model:
                target_model = next(
                    (m for m in vlm_models if m.get('is_default')),
                    vlm_models[0] if vlm_models else None
                )
            if not target_model:
                raise ValueError(f"Service {vlm_service} has no available vision models")

            provider_config = {
                'provider': service_id,
                'model': target_model.get('name', ''),
                'base_url': service.get('base_url', ''),
                'api_key': service.get('api_key', ''),
                'temperature': target_model.get('temperature', 0.7),
                'max_tokens': target_model.get('max_tokens', 1000),
                'top_p': target_model.get('top_p', 0.9),
            }
            if service.get('type') == 'ollama':
                provider_config['auto_unload'] = ollama_auto_unload

            if not provider_config.get('model', ''):
                raise ValueError(f"Please configure model for {vlm_service}")
            if cls._service_requires_api_key(service) and not provider_config.get('api_key', ''):
                raise ValueError(f"Please configure API key and model for {vlm_service}")

            # ------------------------------------------------------------------
            # 3. Analyze image: supports batch (per-frame independent call)
            # ------------------------------------------------------------------
            request_id = generate_request_id("vlm", None, unique_id)

            # Check if multi-frame batch [N, H, W, C] and N > 1
            if len(image.shape) == 4 and image.shape[0] > 1:
                # Batch mode: call VLM independently for each frame
                batch_size = image.shape[0]
                results: list[str] = []

                for i in range(batch_size):
                    single_frame = image[i:i + 1]  # Keep 4D shape [1, H, W, C]
                    image_data = cls._image_to_base64(single_frame)
                    frame_provider_config = provider_config
                    if service.get('type') == 'ollama':
                        frame_provider_config = provider_config.copy()
                        frame_provider_config['auto_unload'] = bool(ollama_auto_unload) and i == batch_size - 1
                    # Generate independent request_id per frame for log tracking
                    frame_request_id = generate_request_id("vlm", None, f"{unique_id}_f{i}")
                    description = cls._analyze_single_image(
                        image_data=image_data,
                        prompt_to_send=prompt_to_send,
                        rule_name=rule_name,
                        service_id=service_id,
                        service=service,
                        provider_config=frame_provider_config,
                        request_id=frame_request_id,
                        frame_index=i
                    )
                    results.append(description)

                # Merge text (consistent with legacy version)
                combined_text = "\n---\n".join(results)
                return io.NodeOutput(combined_text, results)

            else:
                # Single image mode
                image_data = cls._image_to_base64(image)
                description = cls._analyze_single_image(
                    image_data=image_data,
                    prompt_to_send=prompt_to_send,
                    rule_name=rule_name,
                    service_id=service_id,
                    service=service,
                    provider_config=provider_config,
                    request_id=request_id,
                    frame_index=None
                )
                # Single image: caption_list is a single-element list
                return io.NodeOutput(description, [description])

        except InterruptProcessingException:
            raise
        except Exception as e:
            error_msg = format_api_error(e, vlm_service)
            log_error(TASK_IMAGE_CAPTION, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Analysis error: {error_msg}")
