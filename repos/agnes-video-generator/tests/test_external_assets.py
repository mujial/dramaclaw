"""v7.6 外部素材模式单元测试。

覆盖：
- ``core/providers.py`` 注册表（get_provider 回退 / list / has_capability / render_prompt / provider_public）
- ``web.routes.video_routes._resolve_scene_target`` 导入映射
- ``utils.video.normalize_external_video`` / ``probe_media``、``utils.image.normalize_external_image``
- ``BasePipeline._keeps_video_audio``
- ``POST /api/tasks/{id}/artifacts/import`` + ``GET /api/tasks/{id}/artifacts/probe``（TestClient 端到端）

写路径隔离：通过 ``AGNES_REGRESSION_WORKING_DIR`` 环境变量把工作区指向 tmp_path。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import providers
from core.task_manager import TaskManager
from models.task import (
    AudioConfig,
    CreativeVideoTask,
    ManualConfig,
    SceneTask,
    SubtitleConfig,
)
from utils.image import normalize_external_image
from utils.video import normalize_external_video, probe_media
from web.routes import utility_routes, video_routes

_ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock_regression", "assets")
_FIXTURE_VIDEO = os.path.join(_ASSETS, "test_video_5s.mp4")
_FIXTURE_IMAGE = os.path.join(_ASSETS, "test_image.png")


# ═══════════════════════════════════════════════
# core/providers.py
# ═══════════════════════════════════════════════

def test_provider_registry_has_jimeng_only():
    ids = [p.id for p in providers.list_providers()]
    assert ids == ["jimeng"]
    assert providers.DEFAULT_PROVIDER == "jimeng"


def test_get_provider_falls_back_to_default():
    assert providers.get_provider("jimeng").id == "jimeng"
    # 非法 / 空 → 回退默认（设计 §四）
    assert providers.get_provider("bogus").id == "jimeng"
    assert providers.get_provider("").id == "jimeng"


def test_jimeng_capabilities_and_prompts():
    p = providers.get_provider("jimeng")
    for cap in ("native_audio", "duration_control", "subtitle_export", "image_gen"):
        assert providers.has_capability("jimeng", cap)
    # 检查点静态模板覆盖 scenes / references / subtitle（videos 由任务数据动态组装）
    for cp in ("scenes", "references", "subtitle"):
        assert cp in p.checkpoint_prompts
    # videos 的「提示词」改为数据驱动，仅保留操作指引（fill_guide）
    assert "videos" in p.fill_guide
    assert p.url


def test_render_prompt_fills_placeholders():
    prompt = providers.render_prompt(
        "jimeng", "references", "/tmp/taskdir",
        {"scene_count": 3, "total_duration": 15},
    )
    assert "/tmp/taskdir" in prompt
    assert "<任务目录>" not in prompt
    # 未定义的检查点 → 空串
    assert providers.render_prompt("jimeng", "final", "/tmp") == ""


def test_provider_public_excludes_prompt_templates():
    pub = providers.provider_public("jimeng")
    assert pub["id"] == "jimeng"
    assert pub["url"] == "https://jimeng.jianying.com/"
    assert "checkpoint_prompts" not in pub
    with_prompts = providers.provider_public("jimeng", with_prompts=True)
    assert "checkpoint_prompts" in with_prompts


def test_provider_public_exposes_experimental_and_doc_paths():
    """「试验中」气泡与官网说明链接的数据来源：experimental + 只存路径的 doc 链接。"""
    pub = providers.provider_public("jimeng")
    assert pub["experimental"] is True
    # 只存路径（官网强制语言前缀，由前端按 UI 语言拼接）
    assert pub["guide_path"] == "/guides/jimeng-workflow"
    assert pub["faq_path"] == "/faq/jimeng"
    assert not pub["guide_path"].startswith("http")
    assert not pub["faq_path"].startswith("http")
    # 默认值：未声明即为非试验、无官网说明页
    assert providers.Provider(
        id="x", name="X", icon="", capabilities=[],
        checkpoint_prompts={}, fill_guide={},
    ).experimental is False


# ═══════════════════════════════════════════════
# _resolve_scene_target 映射
# ═══════════════════════════════════════════════

def test_resolve_scene_target_mapping():
    r = video_routes._resolve_scene_target
    # 文件名数字 N → scene_{N-1}
    assert r("creative", "video", {}, "scene_1.mp4", 0) == os.path.join("scene_0", "video.mp4")
    # 文件名无数字（去扩展名后）→ 按上传顺序
    assert r("creative", "video", {}, "movie.mp4", 2) == os.path.join("scene_2", "video.mp4")
    # scene_map 显式指定
    assert r("creative", "video", {"1": "scene_2"}, "a.mp4", 0) == os.path.join("scene_2", "video.mp4")
    # 稿件 → para_ 前缀
    assert r("manuscript", "video", {}, "p1.mp4", 0) == os.path.join("para_0", "video.mp4")
    # 图片 → ref.png
    assert r("poetry", "image", {}, "2.png", 1) == os.path.join("scene_1", "ref.png")
    # anchor 无逐场景目录
    assert r("anchor", "video", {}, "x.mp4", 0) == "clip/clip.mp4"
    assert r("anchor", "image", {}, "x.png", 0) == "anchor.png"
    # 场景数上限：文件名数字越界（年份/时间戳）→ 回退上传顺序（而非 scene_2025/）
    assert r("creative", "video", {}, "20261015.mp4", 0, 1) == os.path.join("scene_0", "video.mp4")
    assert r("creative", "video", {}, "video_2025.mp4", 0, 1) == os.path.join("scene_0", "video.mp4")
    # 数字落在 1..scene_count 内 → 仍按序号解析
    assert r("creative", "video", {}, "scene_2.mp4", 0, 3) == os.path.join("scene_1", "video.mp4")
    # 超出 scene_count → 回退上传顺序
    assert r("creative", "video", {}, "scene_7.mp4", 0, 3) == os.path.join("scene_0", "video.mp4")


# ═══════════════════════════════════════════════
# 归一化 + 探针（依赖 ffmpeg / ffprobe，可用则跑）
# ═══════════════════════════════════════════════

def _ffmpeg_available() -> bool:
    from core.compositor.ffmpeg_tool import resolve_binary

    return bool(resolve_binary("ffmpeg"))


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_normalize_external_video_and_probe(tmp_path):
    dst = str(tmp_path / "scene_0" / "video.mp4")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    normalize_external_video(_FIXTURE_VIDEO, dst, 768, 1152)
    assert os.path.exists(dst)

    info = probe_media(dst)
    assert info["duration"] and info["duration"] > 0
    assert info["width"] == 768 and info["height"] == 1152
    assert info["fps"] and info["fps"] > 0
    assert info["vcodec"] == "h264"


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_normalize_external_image_and_probe(tmp_path):
    dst = str(tmp_path / "scene_0" / "ref.png")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    normalize_external_image(_FIXTURE_IMAGE, dst, 768, 1152)
    assert os.path.exists(dst)
    from PIL import Image

    with Image.open(dst) as img:
        assert img.size == (768, 1152)


def test_probe_media_missing_file(tmp_path):
    info = probe_media(str(tmp_path / "nope.mp4"))
    assert info["duration"] == 0.0
    assert info["has_audio"] is False


# ═══════════════════════════════════════════════
# BasePipeline._keeps_video_audio
# ═══════════════════════════════════════════════

class _P:
    """最小鸭子类型：仅提供 _state。"""

    def __init__(self, state):
        self._state = state


def _creative_state(execution_mode="external", audio_source="video"):
    return CreativeVideoTask(
        task_id="ext000000001",
        idea="x",
        scene_count=2,
        scene_durations=[5, 5],
        duration_source="manual",
        audio_config=AudioConfig(enabled=False),
        subtitle_config=SubtitleConfig(enabled=True),
        manual_config=ManualConfig(
            enabled=True,
            pause_points=["videos"],
            execution_mode=execution_mode,
            provider="jimeng",
            audio_source=audio_source,
        ),
    )


def test_keeps_video_audio_flag():
    from core.pipelines import BasePipeline

    assert BasePipeline._keeps_video_audio(_P(_creative_state())) is True
    assert BasePipeline._keeps_video_audio(_P(_creative_state(audio_source="project"))) is False
    assert BasePipeline._keeps_video_audio(_P(_creative_state(execution_mode="manual"))) is False
    # 无 _state（测试替身）不应抛异常
    assert BasePipeline._keeps_video_audio(object()) is False


def test_is_external_flag():
    from core.pipelines import BasePipeline

    assert BasePipeline._is_external(_P(_creative_state(execution_mode="external"))) is True
    assert BasePipeline._is_external(_P(_creative_state(execution_mode="manual"))) is False
    assert BasePipeline._is_external(object()) is False


# ═══════════════════════════════════════════════
# 外部模式跳过 Agnes 素材生成（角色参考图 / 尾帧）
# ═══════════════════════════════════════════════

def _build_creative_pipeline(tmp_path, monkeypatch, mode):
    """构造 creative 流水线（工作区指向 tmp），Agnes 图像调用置为「被调用即失败」。"""
    monkeypatch.setenv("AGNES_REGRESSION_WORKING_DIR", str(tmp_path))
    from core.pipelines.creative import CreativeVideoPipeline

    state = CreativeVideoTask(
        task_id="extpipe",
        idea="x",
        video_width=768,
        video_height=1152,
        scene_count=2,
        scene_durations=[5, 5],
        duration_source="manual",
        audio_config=AudioConfig(enabled=False),
        subtitle_config=SubtitleConfig(enabled=True),
        manual_config=ManualConfig(
            enabled=True,
            pause_points=["videos"],
            execution_mode=mode,
            provider="jimeng",
            audio_source="video",
        ),
    )
    pipeline = CreativeVideoPipeline(api_key="x", task_id="extpipe", dir_name="extpipe")
    pipeline._state = state
    pipeline.task_manager.create(state)

    async def _boom(*args, **kwargs):
        raise AssertionError("Agnes image API must not be called in external mode")

    pipeline.image_generator.generate_single_image = _boom
    return pipeline


@pytest.mark.asyncio
async def test_external_mode_skips_agnes_reference_and_end_frames(tmp_path, monkeypatch):
    """外部模式：角色参考图 / 尾帧提示词 / 尾帧图全部走短路，不调用 Agnes 图像。"""
    pipeline = _build_creative_pipeline(tmp_path, monkeypatch, "external")

    ref = await pipeline._step_character_reference("a story")
    prompts = await pipeline._step_end_frame_prompts("a story", ["s0", "s1"])
    end_frames = await pipeline._step_pregenerate_end_frames(["s0", "s1"], [], ref)

    assert ref == ""
    assert prompts == []
    assert end_frames == {}


def test_external_mode_exposes_coarse_checkpoints(tmp_path, monkeypatch):
    """外部模式：creative 补回粗粒度步骤，使 scenes/references 检查点可暂停。"""
    pipeline = _build_creative_pipeline(tmp_path, monkeypatch, "external")
    steps = pipeline._get_pausable_steps()
    assert "step_build_scenes" in steps
    assert "step_reference_images" in steps

    manual = _build_creative_pipeline(tmp_path, monkeypatch, "manual")
    manual_steps = manual._get_pausable_steps()
    # manual 模式仍走细粒度检查点，不受影响
    assert "step_build_scenes" not in manual_steps
    assert "step_reference_images" not in manual_steps


def test_external_mode_scene_prompt_language_follows_input():
    """外部模式：分镜提示词语言跟随输入原文，不再强制英文。"""
    from core.screenwriter import build_input_language_directive

    arabic = "رحلة قصيرة في الصحراء"
    # 默认（非外部）：分镜视觉提示词仍强制英文
    assert "still write in English" in build_input_language_directive(arabic)
    # 外部素材模式：分镜提示词跟随输入原文语言
    d = build_input_language_directive(arabic, external=True)
    assert "Arabic" in d
    assert "still write in English" not in d
    assert "SAME language as the input idea" in d

    # 中文输入：非外部模式仍返回空串；外部模式显式钉住中文，
    # 避免英文 meta-prompt / 英文 style 把中文 idea 写成英文故事/分镜。
    zh_idea = "海边小镇的暖心故事"
    assert build_input_language_directive(zh_idea) == ""
    zh = build_input_language_directive(zh_idea, external=True)
    assert "Chinese" in zh
    assert "still write in English" not in zh


def test_creative_external_style_directive(tmp_path, monkeypatch):
    """creative：外部模式下 style 指令不再要求分镜英文；manual 模式不变。"""
    external = _build_creative_pipeline(tmp_path, monkeypatch, "external")
    external._state.idea = "رحلة قصيرة في الصحراء"
    external._state.style = "cinematic"
    combined = external._style_with_language_directive()
    assert "still write in English" not in combined
    assert combined.endswith("cinematic")

    manual = _build_creative_pipeline(tmp_path, monkeypatch, "manual")
    manual._state.idea = "رحلة قصيرة في الصحراء"
    manual._state.style = "cinematic"
    assert "still write in English" in manual._style_with_language_directive()


# ═══════════════════════════════════════════════
# 导入 / 探针端点（端到端）
# ═══════════════════════════════════════════════

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AGNES_REGRESSION_WORKING_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(utility_routes.router)
    app.include_router(video_routes.router)
    return TestClient(app)


def _seed_creative_task(task_id="exttask00001", execution_mode="external",
                        audio_source="video", subtitle_source="narration"):
    """在工作区落一个 creative 任务（external 模式，2 场景）。"""
    state = CreativeVideoTask(
        task_id=task_id,
        idea="x",
        video_width=768,
        video_height=1152,
        scene_count=2,
        scene_durations=[5, 5],
        duration_source="manual",
        audio_config=AudioConfig(enabled=False),
        subtitle_config=SubtitleConfig(enabled=True),
        manual_config=ManualConfig(
            enabled=True,
            pause_points=["videos"],
            execution_mode=execution_mode,
            provider="jimeng",
            audio_source=audio_source,
            subtitle_source=subtitle_source,
        ),
    )
    state.scenes = [SceneTask(index=i, scene_prompt=f"scene {i} 画面描述") for i in range(2)]
    TaskManager(task_id, dir_name=task_id).create(state)
    return task_id


def test_get_providers_endpoint(client):
    resp = client.get("/api/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert [p["id"] for p in body["providers"]] == ["jimeng"]
    assert "checkpoint_prompts" not in body["providers"][0]
    # 前端「试验中」气泡 + 官网说明链接依赖这两个字段
    assert body["providers"][0]["experimental"] is True
    assert body["providers"][0]["guide_path"]
    assert body["providers"][0]["faq_path"]


def test_import_kind_validation(client):
    tid = _seed_creative_task()
    resp = client.post(
        f"/api/tasks/{tid}/artifacts/import",
        data={"kind": "audio"},
        files={"files": ("a.mp4", b"x", "video/mp4")},
    )
    assert resp.status_code == 422


def test_import_scene_map_validation(client):
    tid = _seed_creative_task()
    resp = client.post(
        f"/api/tasks/{tid}/artifacts/import",
        data={"kind": "video", "scene_map": "not-json"},
        files={"files": ("a.mp4", b"x", "video/mp4")},
    )
    assert resp.status_code == 422


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_import_video_end_to_end(client):
    tid = _seed_creative_task()
    with open(_FIXTURE_VIDEO, "rb") as f:
        content = f.read()
    resp = client.post(
        f"/api/tasks/{tid}/artifacts/import",
        data={"kind": "video"},
        files=[
            ("files", ("scene_1.mp4", content, "video/mp4")),
            ("files", ("scene_2.mp4", content, "video/mp4")),
        ],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True and body["imported"] == 2 and body["failed"] == 0
    targets = [r["target"] for r in body["results"]]
    assert targets == [os.path.join("scene_0", "video.mp4"), os.path.join("scene_1", "video.mp4")]
    for r in body["results"]:
        assert r["probe"]["width"] == 768 and r["probe"]["height"] == 1152

    # 落盘校验 + 探针端点回显
    task_dir = os.path.join(os.environ["AGNES_REGRESSION_WORKING_DIR"], tid)
    assert os.path.exists(os.path.join(task_dir, "scene_0", "video.mp4"))
    probe = client.get(
        f"/api/tasks/{tid}/artifacts/probe", params={"relpath": "scene_0/video.mp4"},
    )
    assert probe.status_code == 200
    assert probe.json()["width"] == 768


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_import_image_registers_scene_reference(client):
    tid = _seed_creative_task()
    with open(_FIXTURE_IMAGE, "rb") as f:
        content = f.read()
    resp = client.post(
        f"/api/tasks/{tid}/artifacts/import",
        data={"kind": "image"},
        files=[("files", ("ref.png", content, "image/png"))],
    )
    assert resp.status_code == 200, resp.text
    task_dir = os.path.join(os.environ["AGNES_REGRESSION_WORKING_DIR"], tid)
    assert os.path.exists(os.path.join(task_dir, "scene_0", "ref.png"))
    state = TaskManager(tid, dir_name=tid).load()
    assert state.scene_reference_images and state.scene_reference_images[0].endswith(
        os.path.join("scene_0", "ref.png")
    )


def test_probe_endpoint_path_traversal_denied(client):
    tid = _seed_creative_task()
    resp = client.get(
        f"/api/tasks/{tid}/artifacts/probe", params={"relpath": "../task_state.json"},
    )
    assert resp.status_code == 404


def test_external_hint_on_checkpoint(client):
    tid = _seed_creative_task()
    resp = client.get(f"/api/tasks/{tid}/checkpoints/videos")
    assert resp.status_code == 200
    hint = resp.json()["external_hint"]
    assert hint is not None
    assert hint["provider"]["id"] == "jimeng"
    assert hint["provider"]["url"] == "https://jimeng.jianying.com/"
    # videos 检查点的「提示词」= 逐场景分镜脚本（可直接粘贴到即梦），非操作流程说明
    assert "【场景 1/2" in hint["prompt"] and "【场景 2/2" in hint["prompt"]
    assert "scene 0 画面描述" in hint["prompt"] and "scene 1 画面描述" in hint["prompt"]
    # 提示词必须只含画面描述本身，不得泄漏 SceneTask 模型 repr
    assert "scene_prompt=" not in hint["prompt"]
    assert "StepStatus" not in hint["prompt"] and "video_status=" not in hint["prompt"]
    # 操作指引（含即梦操作步骤）单独下发
    assert hint["fill_guide"]


def test_build_external_video_prompts_from_script_file(tmp_path):
    """creative：scenes[].scene_prompt 为空时回退 script.json；容忍 str/dict 两种形态。"""
    from web.routes.video_routes import build_external_video_prompts

    state = _creative_state()
    state.scene_durations = [5, 10]
    script = os.path.join(str(tmp_path), "script.json")
    with open(script, "w", encoding="utf-8") as f:
        json.dump(
            ["第一段画面", {"scene_prompt": "第二段画面", "narration_text": "台词"}],
            f, ensure_ascii=False,
        )
    state.script_file = script
    out = build_external_video_prompts(state, str(tmp_path))
    assert "第一段画面" in out
    assert "第二段画面" in out
    assert "5s" in out and "10s" in out

    # 更贴近真实 creative 任务的形态：scenes 已登记但 scene_prompt 为空 →
    # 必须回退 script.json，而不是把 SceneTask 的 repr 当成提示词（回归修复）
    state.scenes = [SceneTask(index=i, scene_prompt="") for i in (0, 1)]
    out2 = build_external_video_prompts(state, str(tmp_path))
    assert "第一段画面" in out2 and "第二段画面" in out2
    assert "scene_prompt=" not in out2 and "StepStatus" not in out2


# ═══════════════════════════════════════════════
# 检查点 approve：外部素材 videos 校验（v7.6 缺陷 1）
# ═══════════════════════════════════════════════

def _import_fixture_videos(client, tid):
    """向任务导入 2 段 fixture 视频（无音轨），返回导入响应。"""
    with open(_FIXTURE_VIDEO, "rb") as f:
        content = f.read()
    return client.post(
        f"/api/tasks/{tid}/artifacts/import",
        data={"kind": "video"},
        files=[
            ("files", ("scene_1.mp4", content, "video/mp4")),
            ("files", ("scene_2.mp4", content, "video/mp4")),
        ],
    )


def test_approve_videos_without_import_is_rejected(client):
    """未导入任何场景视频 → 确认 videos 检查点必须 422（不再直接放行）。"""
    tid = _seed_creative_task(task_id="approve00001", audio_source="project")
    resp = client.post(
        f"/api/tasks/{tid}/checkpoints/videos/approve", data={"confirmed": "true"},
    )
    assert resp.status_code == 422, resp.text
    assert "1, 2" in resp.json()["detail"]


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_approve_videos_after_import_passes(client, monkeypatch):
    """导入全部场景视频后 → 确认 videos 检查点放行（触发 resume）。"""
    tid = _seed_creative_task(task_id="approve00002", audio_source="project")
    imp = _import_fixture_videos(client, tid)
    assert imp.status_code == 200 and imp.json()["imported"] == 2

    import web.routes.task_routes as task_routes

    async def _fake_resume(task_id):
        return {"ok": True, "resumed": True, "task_id": task_id}

    monkeypatch.setattr(task_routes, "resume_task", _fake_resume)
    resp = client.post(
        f"/api/tasks/{tid}/checkpoints/videos/approve", data={"confirmed": "true"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True


@pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg 不可用")
def test_approve_videos_without_audio_track_passes(client, monkeypatch):
    """音频来源=视频时，已导入视频即使无音轨也放行（音轨由用户自行负责）。"""
    tid = _seed_creative_task(task_id="approve00003", audio_source="video")
    imp = _import_fixture_videos(client, tid)
    assert imp.status_code == 200 and imp.json()["imported"] == 2

    import web.routes.task_routes as task_routes

    async def _fake_resume(task_id):
        return {"ok": True, "resumed": True, "task_id": task_id}

    monkeypatch.setattr(task_routes, "resume_task", _fake_resume)
    resp = client.post(
        f"/api/tasks/{tid}/checkpoints/videos/approve", data={"confirmed": "true"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True


# ═══════════════════════════════════════════════
# keep-audio：本项目不产出音频（v7.6 缺陷 2）
# ═══════════════════════════════════════════════

@pytest.mark.asyncio
async def test_keep_audio_audio_step_produces_no_project_audio(tmp_path, monkeypatch):
    """保留视频自带音轨时，跑完音频步骤不得生成 combined_narration.mp3，也不调 EdgeTTS。"""
    pipeline = _build_creative_pipeline(tmp_path, monkeypatch, "external")
    pipeline._state.narrations = ["旁白文本"]

    from core.audio import tts as tts_mod

    async def _boom(*_a, **_k):
        raise AssertionError("EdgeTTS must not be called in keep-audio mode")

    monkeypatch.setattr(tts_mod.EdgeTTSEngine, "generate", _boom)
    monkeypatch.setattr(tts_mod.EdgeTTSEngine, "harvest_cues", _boom)

    await pipeline._step_audio()

    mp3 = os.path.join(pipeline.working_dir, "combined_narration.mp3")
    assert not os.path.exists(mp3)
    # 旁白纯文本导出仍保留（合成层走 keep-audio，字幕按真实时长）
    assert os.path.exists(os.path.join(pipeline.working_dir, "combined_narration.txt"))


# ═══════════════════════════════════════════════
# 字幕来源：dialogue 取 scenes[].dialogue（v7.6 缺陷 3）
# ═══════════════════════════════════════════════

def test_use_dialogue_subtitles_flag():
    from core.pipelines import BasePipeline

    s = _creative_state()
    s.manual_config.subtitle_source = "dialogue"
    assert BasePipeline._use_dialogue_subtitles(_P(s)) is True
    s.manual_config.subtitle_source = "narration"
    assert BasePipeline._use_dialogue_subtitles(_P(s)) is False


@pytest.mark.asyncio
async def test_creative_dialogue_subtitle_uses_scene_dialogue(tmp_path, monkeypatch):
    """对白字幕来源：creative 字幕文本取自各场景 dialogue，空则回退旁白。"""
    pipeline = _build_creative_pipeline(tmp_path, monkeypatch, "external")
    pipeline._state.manual_config.subtitle_source = "dialogue"
    pipeline._state.scenes = [
        SceneTask(index=0, narration_text="旁白0", dialogue="对白0", duration=5),
        SceneTask(index=1, narration_text="旁白1", dialogue="", duration=5),
    ]

    captured: dict = {}

    async def _fake_common(**kwargs):
        captured.update(kwargs)
        return "", ""

    monkeypatch.setattr(pipeline, "generate_subtitles_common", _fake_common)
    await pipeline._step_subtitle(None)

    # 场景 0 有对白 → 用对白；场景 1 对白为空 → 回退旁白
    assert captured["segment_texts"] == ["对白0", "旁白1"]

