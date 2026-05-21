"""
Video captioning (video understanding) node - V3 version

V3 Migration Notes:
    - Inherits VLMNodeBase + io.ComfyNode
    - INPUT_TYPES -> define_schema()
    - IS_CHANGED -> fingerprint_inputs()
    - def analyze_video_content(self, ...) -> @classmethod execute(cls, ...)

Feature Description:
    - Supports both IMAGE batch (image_sequence) and VIDEO type optional input ports
    - Supports Auto (uniform sampling) and Manual (manual index) two sampling modes
    - Outputs prompt text after frame sampling and preview frame IMAGE tensor
    - Retains detection and truncation logic for model max supported frame count
"""

import base64
import hashlib
from io import BytesIO
from typing import List, Optional, Tuple

import numpy as np
import torch
from PIL import Image as PILImage

from comfy.model_management import InterruptProcessingException
from comfy_api.latest import io

from ..services.vlm import VisionService
from ..utils.common import (
    format_api_error, format_model_with_thinking, generate_request_id,
    log_prepare, log_error, TASK_VIDEO_CAPTION, SOURCE_NODE,
    get_model_max_images, WARN_PREFIX
)
from ..services.thinking_control import build_thinking_suppression
from .base import VLMNodeBase


class VideoCaptionNode(VLMNodeBase, io.ComfyNode):
    """Video captioning node (V3), supports video/image sequence input, auto/manual frame sampling, outputs prompt and preview frames"""

    @classmethod
    def define_schema(cls):
        service_options = cls.get_vlm_service_options()
        default_service = service_options[0] if service_options else "Zhipu"

        from ..config_manager import config_manager
        system_prompts = config_manager.get_system_prompts()

        video_prompts = {}
        active_video_id = None
        if system_prompts:
            video_prompts = system_prompts.get('video_prompts', {}) or {}
            active_video_id = system_prompts.get('active_prompts', {}).get('video')

        prompt_template_options = []
        id_to_display_name = {}
        for key, value in video_prompts.items():
            show_in = value.get('showIn', ["frontend", "node"])
            if 'node' not in show_in:
                continue
            name = value.get('name', key)
            category = value.get('category', '')
            display_name = f"{category}/{name}" if category else name
            id_to_display_name[key] = display_name
            prompt_template_options.append(display_name)

        default_template_name = prompt_template_options[0] if prompt_template_options else "Video-Natural Language"
        if active_video_id and active_video_id in id_to_display_name:
            default_template_name = id_to_display_name[active_video_id]

        if not prompt_template_options:
            prompt_template_options = ["Video-Natural Language"]

        return io.Schema(
            node_id="VideoCaptionNode",
            display_name="✨Video Caption (VLM)",
            category="✨Prompt Assistant",
            description="Extract text prompt from video frames using Vision-Language Models",
            inputs=[
                # IMAGE batch input (compatible with most image sequence nodes)
                io.Image.Input(
                    "video_frames",
                    tooltip="The video frames to analyze (IMAGE batch)",
                    optional=True
                ),
                # VIDEO type input (compatible with VHS and other specialized video nodes)
                io.Video.Input(
                    "video",
                    tooltip="Compatible with VIDEO type nodes (like VHS)",
                    optional=True
                ),
                io.Combo.Input(
                    "rule",
                    options=prompt_template_options,
                    default=default_template_name,
                    tooltip="Preset rule for video captioning",
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
                # Sampling mode: auto uniform / manual index
                io.Combo.Input(
                    "sampling_mode",
                    options=["Auto (Uniform)", "Manual (Indices)"],
                    default="Auto (Uniform)",
                    tooltip="Auto: uniformly sample frames. Manual: specify indices via manual_indices",
                ),
                io.Int.Input(
                    "frame_count",
                    default=5,
                    min=1,
                    max=32,
                    step=1,
                    tooltip="Number of frames to sample (only for Auto mode)"
                ),
                io.String.Input(
                    "manual_indices",
                    default="",
                    tooltip="Specific frame indices for Manual mode, e.g. 0,10,20 or 0-10"
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
                io.String.Output("caption_text"),
                io.Image.Output("preview_frames"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    # -------------------------------------------------------------------------
    # fingerprint_inputs (replaces IS_CHANGED)
    # -------------------------------------------------------------------------

    @classmethod
    def fingerprint_inputs(
        cls,
        video_frames=None, video=None, rule=None, custom_rule=None,
        custom_rule_content=None, user_prompt=None, sampling_mode=None,
        frame_count=None, manual_indices=None, vlm_service=None,
        ollama_auto_unload=None, seed=None
    ):
        temp_rule_hash = hashlib.md5((custom_rule_content or "").encode('utf-8')).hexdigest()
        user_hint_hash = hashlib.md5((user_prompt or "").encode('utf-8')).hexdigest()
        indices_hash = hashlib.md5((manual_indices or "").encode('utf-8')).hexdigest()

        # Extract valid tensor from two input ports for hash computation
        effective_frames = cls._resolve_input_tensor(video_frames, video)

        video_hash = ""
        if effective_frames is not None and hasattr(effective_frames, "shape"):
            try:
                if len(effective_frames.shape) == 4:
                    total = effective_frames.shape[0]
                    idxs = [0, total // 2, total - 1] if total > 2 else list(range(total))
                    hash_data = b""
                    for idx in idxs:
                        h, w = effective_frames.shape[1:3]
                        ch, cw = h // 2, w // 2
                        sz = min(50, h // 4, w // 4)
                        patch = effective_frames[
                            idx,
                            max(0, ch - sz):min(h, ch + sz),
                            max(0, cw - sz):min(w, cw + sz),
                            0
                        ].cpu().numpy().tobytes()
                        hash_data += patch
                    video_hash = hashlib.md5(hash_data).hexdigest()
                else:
                    video_hash = str(effective_frames.shape)
            except Exception:
                video_hash = "hash_error"

        return hash((
            video_hash,
            rule,
            bool(custom_rule),
            temp_rule_hash,
            user_hint_hash,
            sampling_mode,
            frame_count,
            indices_hash,
            vlm_service,
            bool(ollama_auto_unload),
            seed
        ))

    # -------------------------------------------------------------------------
    # Internal helper methods
    # -------------------------------------------------------------------------

    @classmethod
    def _resolve_input_tensor(
        cls,
        video_frames: Optional[torch.Tensor],
        video
    ) -> Optional[torch.Tensor]:
        """
        Resolve a valid frame tensor from two input ports (IMAGE batch or VIDEO type).

        Priority: video_frames first, try extracting from video if empty:
        - dict type (VHS etc.): look for 'frames' / 'video' key
        - torch.Tensor: use directly
        - Objects with frames/video attributes
        """
        # Prefer IMAGE batch port
        if video_frames is not None and video_frames.numel() > 0:
            return video_frames

        # Try extracting from VIDEO port
        if video is None:
            return None

        if isinstance(video, torch.Tensor):
            return video if video.numel() > 0 else None

        # ComfyUI V3 native VideoInput object (io.Video type)
        # Extract frame tensor via get_components().images (shape [N, H, W, C])
        try:
            from comfy_api.input import VideoInput as _VideoInput
            if isinstance(video, _VideoInput):
                components = video.get_components()
                tensor = components.images
                if isinstance(tensor, torch.Tensor) and tensor.numel() > 0:
                    return tensor
                return None
        except Exception:
            pass

        if isinstance(video, dict):
            # VHS nodes typically use 'frames' or 'video' key
            tensor = video.get('frames') or video.get('video')
            if tensor is not None and isinstance(tensor, torch.Tensor):
                return tensor if tensor.numel() > 0 else None
            # Iterate all values, find first Tensor
            for v in video.values():
                if isinstance(v, torch.Tensor) and v.numel() > 0:
                    return v
            return None

        # Compatible with objects having frames/video attributes (legacy VHS etc.)
        for attr in ('frames', 'video'):
            t = getattr(video, attr, None)
            if isinstance(t, torch.Tensor) and t.numel() > 0:
                return t

        # Finally try get_components() duck-typing (non-VideoInput subclass but same interface)
        try:
            components = video.get_components()
            tensor = components.images
            if isinstance(tensor, torch.Tensor) and tensor.numel() > 0:
                return tensor
        except Exception:
            pass

        # Try index access (a few special containers)
        try:
            first = video[0]
            if isinstance(first, torch.Tensor):
                return first
            if isinstance(first, dict):
                t = first.get('frames') or first.get('video')
                if isinstance(t, torch.Tensor):
                    return t
        except Exception:
            pass

        return None

    @classmethod
    def _uniform_sample(cls, total: int, n: int) -> List[int]:
        """
        Uniformly sample n indices from [0, total).
        Algorithm: Divide sequence into n equal-length intervals, take the midpoint of each.
        """
        if n >= total:
            return list(range(total))
        gap = total / n
        return [min(int(i * gap + gap / 2), total - 1) for i in range(n)]

    @classmethod
    def _parse_frame_indices(cls, indices_str: str, total_frames: int) -> List[int]:
        """
        Parse manual frame index string, supports single index and range formats.

        Examples:
            "0,10,20"     -> [0, 10, 20]
            "0-10,50,90"  -> [0,1,...,10,50,90]
            "-1,-5"       -> 1st last frame, 5th last frame
        """
        indices = set()
        if not indices_str or not indices_str.strip():
            return []

        for part in indices_str.split(','):
            part = part.strip()
            if not part:
                continue
            try:
                if '-' in part.lstrip('-'):
                    # Check if it's a range (exclude negative sign)
                    # Find the middle '-' (excluding first character's negative sign)
                    raw = part
                    # Handle leading negative sign first
                    prefix = ""
                    if raw.startswith('-'):
                        prefix = "-"
                        raw = raw[1:]
                    if '-' in raw:
                        left, right = raw.split('-', 1)
                        start = int(prefix + left) if left else 0
                        end = int(right)
                    else:
                        # Pure negative number
                        indices.add(max(0, min((int(part) + total_frames), total_frames - 1)))
                        continue

                    # Handle negative indices
                    if start < 0:
                        start += total_frames
                    if end < 0:
                        end += total_frames
                    start = max(0, min(start, total_frames - 1))
                    end = max(0, min(end, total_frames - 1))
                    if start <= end:
                        indices.update(range(start, end + 1))
                else:
                    idx = int(part)
                    if idx < 0:
                        idx += total_frames
                    indices.add(max(0, min(idx, total_frames - 1)))
            except ValueError:
                print(f"{WARN_PREFIX} Ignoring invalid frame index format: {part}")

        return sorted(list(indices))

    @classmethod
    def _extract_frames_and_tensor(
        cls,
        tensor: torch.Tensor,
        sampling_mode: str,
        frame_count: int,
        manual_indices: str
    ) -> Tuple[List[str], torch.Tensor]:
        """
        Extract frames from tensor according to specified mode, return both base64 list and preview tensor.

        Args:
            tensor        : Frame tensor of shape [N, H, W, C] (ComfyUI IMAGE standard)
            sampling_mode : "Auto (Uniform)" or "Manual (Indices)"
            frame_count   : Target number of frames in auto mode
            manual_indices: Index string in manual mode

        Returns:
            (base64_list, preview_tensor)
            - base64_list  : JPEG base64 data URL per frame
            - preview_tensor: Selected frame tensor, shape [K, H, W, C]
        """
        total = tensor.shape[0]

        if sampling_mode == "Manual (Indices)":
            selected = cls._parse_frame_indices(manual_indices, total)
            if not selected:
                print(f"{WARN_PREFIX} Manual frame indices are invalid or empty, falling back to uniform sampling of 8 frames")
                selected = cls._uniform_sample(total, min(8, total))
        else:
            # Auto (Uniform) mode
            selected = cls._uniform_sample(total, min(frame_count, total))

        # Extract selected frame tensor [K, H, W, C]
        preview_tensor = tensor[selected]

        request_frame_count = preview_tensor.shape[0]
        if request_frame_count <= 4:
            max_edge = 1024
            jpeg_quality = 85
        elif request_frame_count <= 8:
            max_edge = 896
            jpeg_quality = 80
        else:
            max_edge = 768
            jpeg_quality = 75

        # Convert to base64 list
        base64_list = []
        resample_filter = getattr(
            getattr(PILImage, "Resampling", PILImage),
            "LANCZOS",
            PILImage.BICUBIC,
        )
        for i in range(preview_tensor.shape[0]):
            frame_np = (preview_tensor[i].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            img = PILImage.fromarray(frame_np)
            longest_edge = max(img.size)
            if longest_edge > max_edge:
                scale = max_edge / longest_edge
                new_size = (
                    max(1, int(img.size[0] * scale)),
                    max(1, int(img.size[1] * scale)),
                )
                img = img.resize(new_size, resample_filter)
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
            encoded = base64.b64encode(buf.getvalue()).decode('utf-8')
            base64_list.append(f"data:image/jpeg;base64,{encoded}")

        return base64_list, preview_tensor

    # -------------------------------------------------------------------------
    # execute (V3 main execution method)
    # -------------------------------------------------------------------------

    @classmethod
    def execute(
        cls,
        video_frames=None, video=None,
        rule=None, custom_rule=None, custom_rule_content=None,
        user_prompt=None, sampling_mode=None, frame_count=None,
        manual_indices=None, vlm_service=None,
        ollama_auto_unload=None, seed=None
    ):
        unique_id = cls.hidden.unique_id
        request_id = None

        try:
            # ------------------------------------------------------------------
            # 1. Resolve valid frame tensor
            # ------------------------------------------------------------------
            input_tensor = cls._resolve_input_tensor(video_frames, video)
            if input_tensor is None or input_tensor.numel() == 0:
                raise ValueError(
                    "No video frames provided. "
                    "Please connect an IMAGE batch or VIDEO input."
                )

            # ------------------------------------------------------------------
            # 2. Frame sampling (based on mode)
            # ------------------------------------------------------------------
            frames_data, preview_tensor = cls._extract_frames_and_tensor(
                input_tensor,
                sampling_mode or "Auto (Uniform)",
                frame_count or 5,
                manual_indices or ""
            )

            # ------------------------------------------------------------------
            # 3. Build prompt
            # ------------------------------------------------------------------
            rule_name = "Custom Rule" if (custom_rule and custom_rule_content) else rule
            system_message = None

            if custom_rule and custom_rule_content:
                system_message = {"role": "system", "content": custom_rule_content}
            else:
                from ..config_manager import config_manager
                system_prompts = config_manager.get_system_prompts()
                video_prompts = system_prompts.get('video_prompts', {}) if system_prompts else {}

                template_found = False
                for key, value in video_prompts.items():
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
                    system_message = {"role": "system", "content": "Please describe the content of this video in detail."}
                    rule_name = "Default Rule"

            # ------------------------------------------------------------------
            # 4. Parse service and model
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

            # ------------------------------------------------------------------
            # 5. Model max frame count truncation check (retain this mechanism)
            # ------------------------------------------------------------------
            model_full_name = provider_config.get('model')
            max_images = get_model_max_images(model_full_name)

            original_count = len(frames_data)
            truncated_count = 0
            if original_count > max_images:
                frames_data = frames_data[:max_images]
                # Synchronously truncate preview tensor
                preview_tensor = preview_tensor[:max_images]
                truncated_count = original_count - max_images
                print(
                    f"{WARN_PREFIX} ⚠️ Frame truncated | "
                    f"Original:{original_count} -> Actual:{max_images} | "
                    f"Ignored:{truncated_count} frames | Model:{model_full_name}"
                )

            # Inject frame count metadata to help model analyze frame by frame
            actual_frame_count = len(frames_data)
            system_text = (
                system_message.get('content', '')
                if isinstance(system_message, dict)
                else str(system_message)
            )
            frame_info_prefix = (
                f"[Important: This time {actual_frame_count} frame images were provided, "
                f"please analyze each frame and ensure the output description count matches the frame count.]\n\n"
            )
            system_text = frame_info_prefix + system_text
            prompt_to_send = f"{system_text}\n\n{user_prompt}".strip() if user_prompt else system_text

            # ------------------------------------------------------------------
            # 6. Preparation log and API call
            # ------------------------------------------------------------------
            request_id = generate_request_id("video", None, unique_id)

            disable_thinking_enabled = service.get('disable_thinking', True)
            thinking_extra = (
                build_thinking_suppression(service_id, model_full_name)
                if disable_thinking_enabled else None
            )
            model_display = format_model_with_thinking(model_full_name, bool(thinking_extra))
            service_display_name = service.get('name', service_id)

            log_prepare(
                TASK_VIDEO_CAPTION, request_id, SOURCE_NODE,
                service_display_name, model_display, rule_name,
                {"Sampling Mode": sampling_mode, "Frames": len(frames_data)}
            )

            if not provider_config.get('model', ''):
                raise ValueError(f"Please configure model for {vlm_service}")
            if cls._service_requires_api_key(service) and not provider_config.get('api_key', ''):
                raise ValueError(f"Please configure API key and model for {vlm_service}")

            result = cls._run_vision_task(
                VisionService.analyze_images,
                service_id,
                images_data=frames_data,
                prompt_content=prompt_to_send,
                request_id=request_id,
                custom_provider=service_id,
                custom_provider_config=provider_config,
                source=SOURCE_NODE
            )

            # ------------------------------------------------------------------
            # 7. Handle return result
            # ------------------------------------------------------------------
            if result and result.get('success'):
                # Push truncation warning to frontend on success
                if truncated_count > 0:
                    try:
                        from server import PromptServer
                        PromptServer.instance.send_sync("prompt_assistant.warning", {
                            "type": "frame_truncated",
                            "model": model_full_name,
                            "max_images": max_images,
                            "original": original_count,
                            "truncated": truncated_count
                        })
                    except Exception:
                        pass

                data = result.get('data', {})
                caption_text = data.get('description', data.get('caption', '')).strip()
                if not caption_text:
                    error_msg = 'API returned empty result'
                    log_error(TASK_VIDEO_CAPTION, request_id, error_msg, source=SOURCE_NODE)
                    raise RuntimeError(f"Analysis failed: {error_msg}")

                return io.NodeOutput(caption_text, preview_tensor)
            else:
                error_msg = (
                    result.get('error', 'Unknown error') if result
                    else 'No result returned'
                )
                if error_msg == "Task interrupted":
                    raise InterruptProcessingException()
                log_error(TASK_VIDEO_CAPTION, request_id, error_msg, source=SOURCE_NODE)
                raise RuntimeError(f"Analysis failed: {error_msg}")

        except InterruptProcessingException:
            raise
        except Exception as e:
            error_msg = format_api_error(e, vlm_service)
            log_error(TASK_VIDEO_CAPTION, request_id, error_msg, source=SOURCE_NODE)
            raise RuntimeError(f"Analysis error: {error_msg}")
