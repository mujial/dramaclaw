"""core/providers.py — 外部素材工具注册表（v7.6「外部素材模式」）。

纯声明式、无 I/O（与 ``core/dependency_graph.py`` 同风格）：外部素材模式 =
手动模式的增强版，各检查点额外提供**面向外部工具的协作提示词**。提示词按
所选工具（``provider``）渲染，与厂商解耦——新增工具 = 加一条注册项 + 一套
提示词模板，不改流程代码。

首期只内置 ``jimeng``（即梦 / Dreamina），且**不开放用户自定义工具**。

提示词模板取 `docs/plans/v7.6/external_asset_mode_PRD.md` §5；占位符
``<任务目录>`` / ``<场景数>`` / ``<总时长>`` 由 ``render_prompt`` 填充。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

# 能力标识
CAP_NATIVE_AUDIO = "native_audio"          # 原生音频
CAP_DURATION_CONTROL = "duration_control"  # 时长可控
CAP_SUBTITLE_EXPORT = "subtitle_export"    # 可导出字幕时间轴
CAP_IMAGE_GEN = "image_gen"                # 可出分镜图


@dataclass(frozen=True)
class Provider:
    """外部视频生成工具（声明式注册项）。

    Attributes:
        id: 工具标识（持久化到 ``ManualConfig.provider``）。
        name: 显示名兜底（前端优先用 ``name_key`` 走 i18n，缺失时回退本值）。
        name_key: i18n key（如 ``providers.jimeng.name``）。
        icon: 图标（emoji）。
        capabilities: 能力标识集合（见 ``CAP_*``）。
        checkpoint_prompts: 检查点 → 提示词模板（含占位符）。
        fill_guide: 检查点 → 回填指引。
        notes: 能力限制提示兜底（前端优先 ``notes_key``）。
        notes_key: i18n key。
        url: 工具官网链接（前端「打开工具」按钮）。
        experimental: 是否处于**试验阶段**——前端据此展示「试验中」气泡
            （创建面板的工具下拉 / 检查点协作卡片）。
        guide_path: 官网使用说明页面路径（如 ``/guides/jimeng-workflow``，
            **只存路径**：官网强制语言前缀，由前端按当前 UI 语言拼接）。
        faq_path: 官网常见问题页面路径（同上，只存路径）。
    """

    id: str
    name: str
    icon: str
    capabilities: List[str]
    checkpoint_prompts: Dict[str, str]
    fill_guide: Dict[str, str]
    notes: str = ""
    name_key: str = ""
    notes_key: str = ""
    url: str = ""
    experimental: bool = False
    guide_path: str = ""
    faq_path: str = ""


_JIMENG_PROMPTS: Dict[str, str] = {
    "scenes": (
        "你是资深短剧分镜导演。请读取 <任务目录>/script.json，据此为即梦生成"
        "【画面+音频】的创作指令。\n\n"
        "对每个场景，输出一段即梦提示词，包含三部分：\n"
        "1. 画面：主体、构图、镜头运动、光线氛围、色彩基调（与前后场景视觉连续）；\n"
        "2. 音频：明确要求\"生成同步音频\"，写清音频内容（对白/旁白/音效）与音色、语气；\n"
        "3. 时长：给出该段的台词文本与目标时长（秒），要求即梦的音频时长与之一致。\n\n"
        "约束：\n"
        "- 每段台词的**文字与顺序必须与 script.json 的 narration_text 完全一致**"
        "（本项目据此生成字幕）；\n"
        "- 每段目标时长与该场景 duration 一致；\n"
        "- 输出 JSON：{\"scene_index\": n, \"jimeng_prompt\": \"...\", "
        "\"dialogue\": \"...\", \"duration\": n.nn}"
    ),
    "references": (
        "请用即梦的文生图/图生图，按 <任务目录>/script.json 中每个场景的 "
        "scene_prompt 生成分镜图：\n"
        "1. 保持角色外貌、色调、构图在场景间一致（建议先用首图作为参考图统一角色）；\n"
        "2. 输出竖屏 9:16，导出 PNG；\n"
        "3. 导出文件按 scene_1.png / scene_2.png … 命名，回填到 "
        "<任务目录>/scene_{i}/ref.png。"
    ),
    # 注：`videos` 检查点的「提示词」由任务数据动态组装（分镜脚本本身，见
    # web/routes/video_routes.py::build_external_video_prompts），不在此声明静态模板；
    # 该检查点的操作流程说明改由 fill_guide 承担。
    "subtitle": (
        "请确认 <任务目录>/combined_narration.srt 的每条字幕：\n"
        "1. 文案与场景台词逐字一致；\n"
        "2. 末条结束时间不超音轨时长；相邻不重叠（≥50ms 间隔）；中文单条 ≤18 字符；\n"
        "3. 时间轴按各场景实际时长累积偏移，与拼接后视频对齐。\n\n"
        "（增强·即梦可导出字幕时）\n"
        "请从即梦导出字幕/时间轴文件，按 scene 顺序合并，回填到 "
        "<任务目录>/combined_narration.srt。"
    ),
    "audio": (
        "外部音频模式下本检查点自动通过（音频由所选工具随视频一并生成）；"
        "如需叠加本项目配音，请在创建任务时把「音频来源」改为「使用本项目配音」。"
    ),
}

_JIMENG_FILL_GUIDE: Dict[str, str] = {
    "scenes": (
        "1. 复制上面的提示词到即梦（或任意 LLM）生成分镜脚本；\n"
        "2. 确认台词文本与 <任务目录>/script.json 一致；\n"
        "3. 如需修正本项目的分镜脚本，可直接编辑 <任务目录>/script.json 后回填。"
    ),
    "references": (
        "1. 在即梦生成各场景分镜图；\n"
        "2. 导出 PNG，按 scene_1.png / scene_2.png … 命名；\n"
        "3. 回填到 <任务目录>/scene_{i}/ref.png（或用「批量导入」一次选定多张）。"
    ),
    "videos": (
        "1. 点击「打开即梦」，新建视频生成任务；\n"
        "2. 把上方提示词逐场景粘贴到即梦，开启「生成音频」，按各场景时长生成；\n"
        "3. 导出 mp4，按 scene_1.mp4 / scene_2.mp4 … 命名；\n"
        "4. 用下方「批量导入」回填（自动归一化分辨率/帧率/编码并回显体检结果），"
        "或手动放到 <任务目录>/scene_{i}/video.mp4。"
    ),
    "subtitle": (
        "1. 若即梦可导出字幕时间轴，按 scene 顺序合并后回填；\n"
        "2. 否则由本项目按各场景真实时长估时生成，可在 "
        "<任务目录>/combined_narration.srt 手工修正。"
    ),
    "audio": "外部音频模式下无需回填；本检查点不暂停。",
}

PROVIDERS: Dict[str, Provider] = {
    "jimeng": Provider(
        id="jimeng",
        name="Jimeng (Dreamina)",
        name_key="providers.jimeng.name",
        icon="🎬",
        capabilities=[
            CAP_NATIVE_AUDIO,
            CAP_DURATION_CONTROL,
            CAP_SUBTITLE_EXPORT,
            CAP_IMAGE_GEN,
        ],
        checkpoint_prompts=_JIMENG_PROMPTS,
        fill_guide=_JIMENG_FILL_GUIDE,
        notes="分镜视频档位为 5s/10s；导出的 mp4 必须保留音轨。",
        notes_key="providers.jimeng.notes",
        url="https://jimeng.jianying.com/",
        # 即梦协作（外部素材模式）自 v7.6 起提供，仍在打磨中 → 前端展示「试验中」气泡
        experimental=True,
        # 官网新增的说明页（guides/jimeng-workflow / faq/jimeng，22 语言已上线）
        guide_path="/guides/jimeng-workflow",
        faq_path="/faq/jimeng",
    ),
}

# 外部模式默认选中工具（首期唯一）
DEFAULT_PROVIDER = "jimeng"


def get_provider(pid: str) -> Provider:
    """取工具注册项；非法 / 空 id 回退 ``DEFAULT_PROVIDER``。"""
    return PROVIDERS.get(pid or "", PROVIDERS[DEFAULT_PROVIDER])


def list_providers() -> List[Provider]:
    """全部已注册工具（保持声明顺序）。"""
    return list(PROVIDERS.values())


def has_capability(pid: str, cap: str) -> bool:
    """工具是否声明某项能力。"""
    return cap in get_provider(pid).capabilities


def render_prompt(
    pid: str,
    checkpoint: str,
    working_dir: str,
    extra: Optional[dict] = None,
) -> str:
    """渲染某检查点的协作提示词（填充占位符）。

    Args:
        pid: 工具 id（非法回退默认）。
        checkpoint: 检查点名（scenes/references/videos/audio/subtitle）。
        working_dir: 任务工作目录（替换 ``<任务目录>``）。
        extra: 可选上下文（``scene_count`` / ``total_duration``）。

    Returns:
        已填充的提示词；该工具未定义该检查点提示词时返回空串。
    """
    template = get_provider(pid).checkpoint_prompts.get(checkpoint, "")
    if not template:
        return ""
    extra = extra or {}
    scene_count = extra.get("scene_count") or 0
    total_duration = extra.get("total_duration") or 0
    return (
        template.replace("<任务目录>", working_dir or "")
        .replace("<场景数>", str(scene_count) if scene_count else "N")
        .replace("<总时长>", f"{total_duration:g}" if total_duration else "N")
    )


def provider_public(pid: str, *, with_prompts: bool = False) -> dict:
    """工具的对外 JSON 表示（供路由下发）。

    Args:
        pid: 工具 id。
        with_prompts: 是否附带各检查点提示词模板（体积大，默认不带）。

    Returns:
        dict（前端 i18n 优先 ``name_key`` / ``notes_key``，缺失回退 ``name`` / ``notes``）。
    """
    p = get_provider(pid)
    data = {
        "id": p.id,
        "name": p.name,
        "name_key": p.name_key,
        "icon": p.icon,
        "capabilities": list(p.capabilities),
        "notes": p.notes,
        "notes_key": p.notes_key,
        "url": p.url,
        "experimental": p.experimental,
        "guide_path": p.guide_path,
        "faq_path": p.faq_path,
    }
    if with_prompts:
        data["checkpoint_prompts"] = dict(p.checkpoint_prompts)
        data["fill_guide"] = dict(p.fill_guide)
    return data
