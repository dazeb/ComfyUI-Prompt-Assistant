"""
Video frame extraction utility module
Provides precise frame extraction functionality based on frame index
Uses imageio instead of cv2 to reduce dependency conflicts and improve compatibility
"""

import imageio
import base64
import os
from io import BytesIO
from PIL import Image
import numpy as np


# ---Core frame extraction functionality---

def extract_frame_by_index(video_path, frame_index, force_rate=0):
    """
    Extract an image at a specified frame index from a video
    
    Args:
        video_path: Path to the video file
        frame_index: Target frame index (relative to force_rate processed frame sequence)
        force_rate: Forced frame rate, 0 means use original frame rate
    
    Returns:
        dict: {success, data (base64 JPEG), width, height} or {success, error}
    """
    reader = None
    try:
        # Read video using imageio
        reader = imageio.get_reader(video_path, 'ffmpeg')
        meta = reader.get_meta_data()
        
        # Get original video properties
        original_fps = meta.get('fps', 0)
        total_original_frames = 0
        try:
            total_original_frames = reader.count_frames()
        except Exception:
            # If frame count cannot be obtained, try to calculate from duration and fps
            duration = meta.get('duration', 0)
            if duration > 0 and original_fps > 0:
                total_original_frames = int(duration * original_fps)
        
        if original_fps <= 0:
            if reader: reader.close()
            return {"success": False, "error": "Unable to get video frame rate"}
        
        # Calculate the actual original frame position to read
        if force_rate > 0 and abs(force_rate - original_fps) > 0.1:
            # force_rate changes frame sampling: sample proportionally from original frames
            # Frame index i corresponds to original frame position = i * (original_fps / force_rate)
            actual_frame_pos = int(frame_index * (original_fps / force_rate))
        else:
            actual_frame_pos = frame_index
        
        # Boundary check
        if total_original_frames > 0:
            if actual_frame_pos >= total_original_frames:
                actual_frame_pos = total_original_frames - 1
        if actual_frame_pos < 0:
            actual_frame_pos = 0
            
        # Read frame
        try:
            frame = reader.get_data(actual_frame_pos)
        except (IndexError, ValueError):
            # If out of range, try to read the last frame
            try:
                frame = reader.get_data(0)  # Fallback
            except Exception:
                if reader: reader.close()
                return {"success": False, "error": f"Unable to read frame {actual_frame_pos}"}
        
        if frame is None:
            if reader: reader.close()
            return {"success": False, "error": f"Read frame is empty {actual_frame_pos}"}
        
        # frame from imageio is a numpy array in RGB format
        # Convert to PIL Image for processing
        img = Image.fromarray(frame)
        
        # Encode as JPEG
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=60)
        
        # Base64 encoding
        base64_data = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        width, height = img.size
        
        return {
            "success": True,
            "data": base64_data,
            "width": width,
            "height": height,
            "frame_index": frame_index,
            "actual_frame_pos": actual_frame_pos
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if reader:
            try:
                reader.close()
            except Exception:
                pass


def get_video_frame_info(video_path, force_rate=0):
    """
    Get video frame related information
    
    Args:
        video_path: Path to the video file
        force_rate: Forced frame rate
    
    Returns:
        dict: {success, original_fps, force_fps, total_frames, duration}
    """
    reader = None
    try:
        reader = imageio.get_reader(video_path, 'ffmpeg')
        meta = reader.get_meta_data()
        
        original_fps = meta.get('fps', 0)
        duration = meta.get('duration', 0)
        
        try:
            total_original_frames = reader.count_frames()
        except Exception:
            if duration > 0 and original_fps > 0:
                total_original_frames = int(duration * original_fps)
            else:
                total_original_frames = 0
        
        if original_fps <= 0:
            # Some formats may not have fps, try to infer from duration and total frame count
            if duration > 0 and total_original_frames > 0:
                original_fps = total_original_frames / duration
            else:
                if reader: reader.close()
                return {"success": False, "error": "Unable to get video frame rate"}
        
        if duration <= 0:
            if original_fps > 0 and total_original_frames > 0:
                duration = total_original_frames / original_fps
        
        # Calculate actual frame count after force_rate
        if force_rate > 0:
            actual_fps = force_rate
            actual_total_frames = int(duration * force_rate)
        else:
            actual_fps = original_fps
            actual_total_frames = total_original_frames
        
        return {
            "success": True,
            "original_fps": original_fps,
            "actual_fps": actual_fps,
            "original_total_frames": total_original_frames,
            "actual_total_frames": actual_total_frames,
            "duration": duration
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if reader:
            try:
                reader.close()
            except Exception:
                pass
