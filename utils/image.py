"""
Image processing utility module
Provides image tensor conversion, hash computation and other general image processing methods
"""

import base64
import hashlib
from io import BytesIO
from typing import Optional

import numpy as np
import torch
from PIL import Image


def tensor_to_base64(image_tensor: torch.Tensor, quality: int = 95) -> str:
    """
    Convert image tensor to base64-encoded data URL
    
    Args:
        image_tensor: Image tensor, shape [H, W, C] or [B, H, W, C]
        quality: JPEG compression quality (1-100), default 95
    
    Returns:
        Base64-encoded data URL, format: "data:image/jpeg;base64,..."
    """
    # If 4D tensor, take the first image
    if len(image_tensor.shape) == 4:
        image_tensor = image_tensor[0]
    
    # Convert to numpy array and scale to 0-255 range
    image_np = (image_tensor.cpu().numpy() * 255).astype(np.uint8)
    
    # Create PIL image
    image = Image.fromarray(image_np)
    
    # Convert to JPEG byte stream
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    
    # Convert to base64 encoding
    encoded_image = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    # Return data URL with MIME type
    return f"data:image/jpeg;base64,{encoded_image}"


def compute_image_hash(image_tensor: Optional[torch.Tensor]) -> str:
    """
    Compute hash of image tensor for IS_CHANGED detection
    
    Algorithm: Only uses the center region of the first frame as hash input to avoid excessive computation
    
    Args:
        image_tensor: Image tensor, shape [B, H, W, C] or None
    
    Returns:
        MD5 hash hex string, returns "0" if input is None or computation fails
    """
    if image_tensor is None:
        return "0"
    
    try:
        if len(image_tensor.shape) == 4:
            # Take center region of first frame as hash input
            h, w = image_tensor.shape[1:3]
            center_h, center_w = h // 2, w // 2
            size = min(100, h // 4, w // 4)  # Limit computation region size
            
            img_data = image_tensor[0,
                                   max(0, center_h - size):min(h, center_h + size),
                                   max(0, center_w - size):min(w, center_w + size),
                                   0].cpu().numpy().tobytes()
            return hashlib.md5(img_data).hexdigest()
        else:
            # If not 4D tensor, use hash of the entire tensor
            img_data = image_tensor.cpu().numpy().tobytes()
            return hashlib.md5(img_data).hexdigest()
    except Exception:
        return "0"
