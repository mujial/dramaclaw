import json
import logging
import os
import subprocess
from typing import Optional

import requests
from tenacity import retry, stop_after_attempt, wait_fixed

from core.compositor.ffmpeg_tool import (
    has_audio_stream,
    probe_duration,
    probe_video_dimensions,
    resolve_binary,
)

logger = logging.getLogger(__name__)


# B6: 下载安全限制（防写满磁盘）
_MAX_VIDEO_SIZE = 500 * 1024 * 1024  # 500 MB

# 下载重试退避间隔（秒）：此前无 wait，3 次重试会瞬间连续发起，加剧服务端压力
_DOWNLOAD_RETRY_WAIT_SECONDS = 3


@retry(stop=stop_after_attempt(3), wait=wait_fixed(_DOWNLOAD_RETRY_WAIT_SECONDS))
def download_video(url: str, save_path: str, max_size: int = _MAX_VIDEO_SIZE) -> None:
    logger.info(f"Downloading video from {url} to {save_path}")
    resp = requests.get(url, timeout=(30, 300), stream=True)
    resp.raise_for_status()
    # 优先检查 Content-Length
    content_length = resp.headers.get("Content-Length")
    if content_length and int(content_length) > max_size:
        raise ValueError(f"Video too large: {content_length} bytes > max {max_size} bytes")
    downloaded = 0
    with open(save_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            downloaded += len(chunk)
            if downloaded > max_size:
                raise ValueError(f"Video exceeded max_size {max_size} bytes during download")
            f.write(chunk)
    logger.info(f"Video saved to {save_path} ({downloaded} bytes)")


def normalize_external_video(
    src: str,
    dst: str,
    width: int,
    height: int,
    fps: int = 30,
) -> str:
    """把外部工具（如即梦）导出的视频归一化到任务目标规格（v7.6）。

    统一分辨率（等比缩放 + 居中 pad，保持 9:16 画幅）、帧率与编码
    （libx264 + yuv420p + AAC 44100/2ch），使多片段拼接能命中
    ``-c copy`` 快速路径。**音轨默认保留**；源片段无音轨时输出 ``-an``
    （不补静音，交由合成层 ``0:a?`` 语义处理）。

    Args:
        src: 源视频路径。
        dst: 输出路径。
        width: 目标宽（像素）。
        height: 目标高（像素）。
        fps: 目标帧率。

    Returns:
        输出路径。

    Raises:
        RuntimeError: ffmpeg 不可用或执行失败。
    """
    ffmpeg = resolve_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not available for external video normalization")

    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )
    cmd = [
        ffmpeg, "-y", "-i", src,
        "-vf", vf, "-r", str(fps),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
    ]
    if has_audio_stream(src):
        cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"]
    else:
        cmd += ["-an"]
    cmd += ["-movflags", "+faststart", dst]

    r = subprocess.run(
        cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600,
    )
    if r.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) == 0:
        raise RuntimeError(
            f"external video normalization failed (code {r.returncode}): "
            f"{(r.stderr or '')[:500]}"
        )
    logger.info(
        "[External] Normalized %s → %s (%dx%d @%dfps, audio=%s)",
        src, dst, width, height, fps, "keep" if has_audio_stream(src) else "none",
    )
    return dst


def probe_media(path: str) -> dict:
    """探测媒体文件信息（导入体检回显，v7.6）。

    优先 ffprobe JSON；ffprobe 不可用时回退 ``ffmpeg_tool`` 的兜底探测
    （时长/宽高/有无音轨），帧率与编码则返回 ``None``。

    Args:
        path: 媒体文件路径。

    Returns:
        ``{duration,width,height,fps,has_audio,vcodec,acodec}``；文件不存在时
        各项为 ``None`` / ``0``。
    """
    info: dict = {
        "duration": 0.0,
        "width": None,
        "height": None,
        "fps": None,
        "has_audio": False,
        "vcodec": None,
        "acodec": None,
    }
    if not path or not os.path.exists(path):
        return info

    ffprobe = resolve_binary("ffprobe")
    if ffprobe:
        try:
            r = subprocess.run(
                [ffprobe, "-v", "quiet", "-print_format", "json",
                 "-show_format", "-show_streams", path],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
            )
            data = json.loads(r.stdout or "{}")
            info["duration"] = float(data.get("format", {}).get("duration") or 0.0)
            for s in data.get("streams", []):
                if s.get("codec_type") == "video" and info["width"] is None:
                    info["width"] = s.get("width")
                    info["height"] = s.get("height")
                    info["vcodec"] = s.get("codec_name")
                    info["fps"] = _parse_fps(s.get("avg_frame_rate") or s.get("r_frame_rate"))
                elif s.get("codec_type") == "audio" and info["acodec"] is None:
                    info["acodec"] = s.get("codec_name")
                    info["has_audio"] = True
            return info
        except Exception as e:
            logger.warning("[External] ffprobe media probe failed: %s", e)

    # 兜底：ffmpeg_tool 的三级探测
    info["duration"] = probe_duration(path)
    info["width"], info["height"] = probe_video_dimensions(path)
    info["has_audio"] = has_audio_stream(path)
    return info


def _parse_fps(rate: Optional[str]) -> Optional[float]:
    """把 ffprobe 的 ``30000/1001`` 帧率表示转为浮点（``0/0`` 等非法值返回 None）。"""
    if not rate or "/" not in rate:
        return None
    num, _, den = rate.partition("/")
    try:
        den_f = float(den)
        if den_f == 0:
            return None
        return round(float(num) / den_f, 3)
    except ValueError:
        return None