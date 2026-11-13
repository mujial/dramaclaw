"""compositor 兜底分支单测（水印失败回退、保留原音轨烧字幕失败、fast path 不适用）。

对应 Sonar S3516 重构后的单出口（single-exit）写法：每个函数只在结尾
``return ok``，失败原因靠内部标志/内部信号 ``_CopyConcatSkipped`` 表达，
本用例锁定重构前后行为一致（成功 True / 失败 False + 原样拷贝兜底）。
"""
import subprocess
from types import SimpleNamespace

import pytest

from core.compositor import watermark as wm
from core.compositor.concatenator import audio_overlay as ao
from core.compositor.concatenator import concat as cc
from core.compositor.concatenator.concat import ConcatMixin

FONT = wm.resolve_font_path("STHeitiMedium.ttc")


def _fake_run(returncode: int = 0, stderr: str = ""):
    """构造 subprocess.run 替身（不真正调用 ffmpeg）。"""
    def run(*args, **kwargs):
        return SimpleNamespace(returncode=returncode, stderr=stderr, stdout="")
    return run


# ── add_watermark：输入缺失 / 字体缺失 / 渲染失败都返回 False ──

def test_add_watermark_missing_input_returns_false(tmp_path):
    """输入不存在：返回 False，且不产生输出文件（无源可拷贝）。"""
    dst = tmp_path / "out.mp4"
    assert wm.add_watermark(str(tmp_path / "nope.mp4"), str(dst)) is False
    assert not dst.exists()


def test_add_watermark_missing_font_copies_original(tmp_path):
    """字体缺失：返回 False，但输出为原视频拷贝（保证下游有可播放文件）。"""
    src = tmp_path / "in.mp4"
    src.write_bytes(b"fake-video-bytes")
    dst = tmp_path / "out.mp4"
    ok = wm.add_watermark(
        str(src), str(dst), video_width=320, video_height=240,
        font_path=str(tmp_path / "missing-font.ttf"),
    )
    assert ok is False
    assert dst.read_bytes() == src.read_bytes()


def test_add_watermark_render_png_failure_copies_original(tmp_path, monkeypatch):
    """水印 PNG 渲染失败：返回 False 并原样拷贝。"""
    src = tmp_path / "in.mp4"
    src.write_bytes(b"fake-video-bytes")
    dst = tmp_path / "out.mp4"
    monkeypatch.setattr(wm, "_render_watermark_png", lambda *a, **k: None)
    ok = wm.add_watermark(
        str(src), str(dst), video_width=320, video_height=240, font_path=FONT,
    )
    assert ok is False
    assert dst.read_bytes() == src.read_bytes()


# ── _overlay_watermark：成功 / ffmpeg 失败 / 超时 三态 ──

def _layout():
    return wm.WatermarkLayout(pos_x=10, pos_y=10, box_w=100, box_h=40)


def test_overlay_watermark_success(tmp_path, monkeypatch):
    """ffmpeg 返回 0 → True（不真正调用 ffmpeg）。"""
    monkeypatch.setattr(wm, "_render_watermark_png", lambda *a, **k: _layout())
    monkeypatch.setattr(wm.subprocess, "run", _fake_run(0))
    assert wm._overlay_watermark(
        str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4"), 320, 240, "zh", FONT,
    ) is True


def test_overlay_watermark_ffmpeg_failure(tmp_path, monkeypatch):
    """ffmpeg 非 0 → False。"""
    monkeypatch.setattr(wm, "_render_watermark_png", lambda *a, **k: _layout())
    monkeypatch.setattr(wm.subprocess, "run", _fake_run(1, "boom"))
    assert wm._overlay_watermark(
        str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4"), 320, 240, "zh", FONT,
    ) is False


def test_overlay_watermark_timeout(tmp_path, monkeypatch):
    """ffmpeg 超时 → False（不抛异常）。"""
    monkeypatch.setattr(wm, "_render_watermark_png", lambda *a, **k: _layout())

    def _timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=300)

    monkeypatch.setattr(wm.subprocess, "run", _timeout)
    assert wm._overlay_watermark(
        str(tmp_path / "in.mp4"), str(tmp_path / "out.mp4"), 320, 240, "zh", FONT,
    ) is False


# ── _burn_subtitle_keep_audio：SRT→ASS 失败 → False ──

def test_burn_subtitle_keep_audio_conversion_failure(monkeypatch):
    """SRT→ASS 转换抛异常：返回 False（调用方降级为仅拼接）。"""
    def _boom(*args, **kwargs):
        raise RuntimeError("probe failed")

    monkeypatch.setattr(ao.AudioOverlayMixin, "_get_video_size", staticmethod(_boom))
    assert ao.AudioOverlayMixin._burn_subtitle_keep_audio(
        "in.mp4", "sub.srt", "out.mp4", None,
    ) is False


def test_copy_concat_fast_path_probe_mismatch(tmp_path, monkeypatch):
    """片段分辨率/帧率不一致：fast path 不适用 → False，且不残留 concat 列表文件。"""
    stdout_by_path = {"a.mp4": "1920x1080x30", "b.mp4": "1280x720x30"}

    def run(cmd, *args, **kwargs):
        target = cmd[-1]
        return SimpleNamespace(
            returncode=0, stdout=stdout_by_path.get(target, ""), stderr="",
        )

    monkeypatch.setattr(cc.subprocess, "run", run)
    out = tmp_path / "out.mp4"
    assert ConcatMixin._try_ffmpeg_copy_concat(["a.mp4", "b.mp4"], str(out)) is False
    assert not (tmp_path / "out.mp4.concat.txt").exists()


def test_copy_concat_fast_path_probe_error(tmp_path, monkeypatch):
    """ffprobe 失败：fast path 不适用 → False。"""
    monkeypatch.setattr(
        cc.subprocess, "run",
        lambda cmd, *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="err"),
    )
    out = tmp_path / "out.mp4"
    assert ConcatMixin._try_ffmpeg_copy_concat(["a.mp4"], str(out)) is False


@pytest.mark.parametrize("paths", [["a.mp4"], ["a.mp4", "b.mp4"]])
def test_copy_concat_skip_signal_is_internal(paths, tmp_path, monkeypatch):
    """内部信号 _CopyConcatSkipped 不向调用方泄漏（一律转成 False）。"""
    assert issubclass(cc._CopyConcatSkipped, Exception)
    monkeypatch.setattr(
        cc.subprocess, "run",
        lambda cmd, *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="err"),
    )
    out = tmp_path / "out.mp4"
    assert ConcatMixin._try_ffmpeg_copy_concat(paths, str(out)) is False
