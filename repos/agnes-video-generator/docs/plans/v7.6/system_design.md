# v7.6「外部素材模式」（即梦协作）增量设计

> **状态**：🟢 已实施（P0–P3）
> **版本**：v0.1（2026-10-15）
> **上游方案**：`docs/plans/v7.6/external_asset_mode_PRD.md`（v0.2）
> **定位**：PRD 评审通过后的**增量代码设计**——只列**改动清单与接口契约**，不重复 PRD 的需求论证。

---

## 一、总体结论

外部素材模式 = **手动模式的增强版**，复用同一套「暂停 / approve / 依赖图 / resume」机制，仅新增三件事：

1. 执行模式第三值 `external`（`ManualConfig.execution_mode`），配套 `provider` / `asset_source`；
2. **工具注册表**（首期 `jimeng`）与按工具渲染的协作提示词；
3. 产物**批量导入 / 探针 / 归一化**端点。

**不新增执行引擎**：`_maybe_pause` 命中逻辑不变，`external` 与 `manual` 走同一条路径。

---

## 二、模型增量（`models/task.py`）

`ManualConfig` 新增字段（全部带默认值，旧状态反序列化自动取默认）：

```python
class ManualConfig(BaseModel):
    ...                                   # 既有：enabled / pause_points / approved_checkpoints / ...
    execution_mode: str = "auto"          # auto | manual | external
    provider: str = ""                    # 外部工具 id（external 模式；首期仅 "jimeng"）
    audio_source: str = "project"         # project | video（外部素材默认 video）
```

约定：

| 字段 | 取值 | 语义 |
|------|------|------|
| `execution_mode` | `auto` / `manual` / `external` | `external` 时 `enabled=True`（复用 `_maybe_pause`） |
| `provider` | `jimeng`（首期唯一） | 缺失/非法 → 回退 `jimeng` |
| `audio_source` | `video` / `project` | `video` = 保留视频自带音轨、不生成 TTS；`project` = 现状（edge_tts） |

`audio_config.enabled` 由创建路由按 `audio_source` 推导：`external + audio_source=video` → `AudioConfig(enabled=False)`；其余保持现状。

**默认暂停点（external）**：`creative` = `["scenes","references","videos","subtitle"]`；`manuscript` / `poetry` = `["scenes","videos","subtitle"]`；`anchor` = `["scenes","videos"]`。
`audio` 检查点在 `audio_source=video` 时**自动通过**（不暂停，也不参与 approve 列表）。

---

## 三、工具注册表（新模块 `core/providers.py`）

纯声明式、无 I/O，与 `core/dependency_graph.py` 同风格。

```python
@dataclass(frozen=True)
class Provider:
    id: str
    name: str                      # 显示名（zh/en 由前端 i18n 覆盖，缺失则回退）
    icon: str
    capabilities: list[str]        # native_audio | duration_control | subtitle_export | image_gen
    checkpoint_prompts: dict[str, str]   # scenes / references / videos / subtitle → 提示词模板
    fill_guide: dict[str, str]     # 各检查点回填指引
    notes: str

PROVIDERS: dict[str, Provider] = {"jimeng": Provider(...)}

def get_provider(pid: str) -> Provider        # 非法/空 → 回退 "jimeng"
def list_providers() -> list[Provider]
def render_prompt(pid, checkpoint, working_dir, extra: dict) -> str   # 填充 <任务目录> 等占位
def has_capability(pid, cap) -> bool
```

占位符：`<任务目录>`（= `working_dir`）、`<场景数>`、`<总时长>`。

**能力降级（PRD §2.4）**：`native_audio` 缺失 → `audio_source` 强制 `project`；其余能力缺失仅影响提示词文案，不改流程。

---

## 四、路由增量

| 端点 | 改动 |
|------|------|
| `GET /api/providers` | **新增**（`web/routes/utility_routes.py`）。返回注册表：`{"ok":true,"providers":[{id,name,icon,capabilities,notes,experimental,guide_path,faq_path}]}`（**不含**提示词模板，减小体积；模板走检查点详情）。`experimental` = 是否试验阶段（前端渲染「🧪 试验中」气泡）；`guide_path` / `faq_path` = 官网说明与常见问题**路径**（不含语言前缀、不含域名，官网强制 `/zh`、`/en` 前缀，由前端按 UI 语言拼接） |
| 创建端点（creative/manuscript/poetry/anchor） | `execution_mode` 增加 `external`；新增 `provider: str = Form("jimeng")`；`audio_source: str = Form("project")`（external 时前端传 `video`） |
| `GET /api/tasks/{id}/checkpoints/{cp}` | 响应新增 `external_hint`：`{"provider":{id,name,icon,url,experimental,guide_path,faq_path},"prompt":"...","fill_guide":"...","notes":"..."}`；非 external 任务为 `null`。`videos` 检查点的 `prompt` **非静态模板**，由 `build_external_video_prompts`（[video_routes.py](file:///Users/lcy/video/agnes-video-generator/web/routes/video_routes.py)）按任务数据（`scenes[].scene_prompt` → `script_file` → `paragraphs`）逐场景组装为可粘贴的分镜提示词 |
| `POST /api/tasks/{id}/artifacts/import` | **新增**：multipart `files[]` + `kind`（`image`/`video`）+ `scene_map`（JSON，`{"1":"scene_0",...}`，缺省按文件名序号/上传顺序映射到 `scene_{i}`）；服务端**归一化 + 探针回显** |
| `GET /api/tasks/{id}/artifacts/probe?relpath=...` | **新增**：单文件探针（duration/width/height/fps/has_audio/vcodec/acodec） |

`_build_manual_config` 扩展签名：

```python
def _build_manual_config(execution_mode: str, pause_points: str,
                         provider: str = "jimeng", audio_source: str = "project") -> ManualConfig
```

非法 `provider` → 回退 `jimeng`；非法 `audio_source` → 422。

### 4.1 实现补充（与设计原文的差异，均已落地）

1. **`auto` 早返回先于 `audio_source` 校验**：`_build_manual_config` 在 `execution_mode == "auto"` 时
   立即返回 `ManualConfig()`，`audio_source` / `pause_points` 校验其后。原因：旧兼容端点
   （`create_task_legacy`）不传新增的 `Form` 字段，早返回可避免其拿到 `FieldInfo` 对象而 422。
   manual 分支显式置 `execution_mode="manual"`（此前默认 `auto`，语义错误）。
2. **anchor 的 `audio_source` 词汇自适应映射**：anchor 端点原有 `audio_source: str = Form("post_stitch")`
   值域为 `post_stitch`/`model`（模型自带口型音频），与外部素材新增的 `project`/`video` 语义重叠但取值不同。
   端点做**词汇自适应**：`video→model`（+ `asset_audio_source="video"`）、`project→post_stitch`
   （+ `"project"`）、其他保持原值——前端「覆盖式」传参即可，不需要 anchor 单独分支。
3. **`scene_{i}/ref.png` 需配合 `scene_reference_images` 登记**：creative 流水线并不直接读取
   `scene_{i}/ref.png`（仅 `_user_scene_ref` 取 `state.scene_reference_images[scene_idx]`）。
   故 `kind=image` + creative 导入时，端点除落盘 `scene_{i}/ref.png` 外，**同时登记**
   `state.scene_reference_images[pos]`（并 `tm.update_state`），使该场景以导入图为参考、
   跳过 AI 分镜图生成。其余类型（manuscript/poetry）导入图仅作参考图落盘，不改登记。
4. **外部模式不调用 Agnes 生成素材（角色参考图 / 尾帧绑定 Agnes 图像模型）**：
   creative 的 `_step_character_reference` / `_step_end_frame_prompts` / `_step_pregenerate_end_frames`
   在 `_is_external()` 为真时**直接短路**（分别返回用户已有参考图 / `[]` / `{}`），
   不再调用 Agnes 图像模型自动生成。尾帧由外部工具产出后经 `references` 检查点导入
   （`use_custom_end_frames` / `generate_end_frames_from_ref` 复选框仅决定非外部模式的尾帧来源）。
5. **creative 外部模式启用粗粒度检查点**：creative 默认走细粒度可暂停步骤（`_get_pausable_steps`
   排除 `step_build_scenes` / `step_reference_images`）；外部模式暂停点为粗粒度
   `scenes` / `references` / `videos` / `subtitle`，故 external 时补回上述两个粗粒度步骤，
   使其完成后能在 `scenes` / `references` 暂停供导入产物（manual 模式行为不变）。
6. **外部模式视频步骤短路（本项目不产出分镜视频/尾帧）**：`_step_generate_videos`
   （creative，[steps_video.py](file:///Users/lcy/video/agnes-video-generator/core/pipelines/creative/steps_video.py)）
   与通用 `_generate_videos`（[multi_scene.py](file:///Users/lcy/video/agnes-video-generator/core/pipelines/multi_scene.py)）
   在 `_is_external()` 为真时**直接短路**：只登记磁盘上已存在的分镜视频（`scene_{i}/video.mp4`），
   **既不提交 Agnes 视频，也不触发 keyframes 内建的尾帧图像兜底**，随后在 `videos` 检查点暂停
   等待用户回填。对应 PRD 检查点产物矩阵中 `videos` 的「本项目产物」为「—」。
   2026-10-15 实测：修复前外部模式在暂停于 `videos` 之前仍以 Agnes 生成 3 张尾帧图 + 3 段视频。
7. **前端外部模式尾帧选项**：`CreativeForm.vue` 中 `genEndFromRef` 默认 `false`；
   切换/进入 external 时取消并禁用两个尾帧复选框。
8. **外部模式分镜提示词语言与输入原文一致**：`build_input_language_directive` 新增
   `external` 参数（默认 `False` 保持既有行为）。非外部模式对非中文输入仍保留
   「场景视觉提示词用英文」约定；外部模式改为要求分镜提示词**与输入原文语言一致**
   （不翻译成英文），使交给外部工具（即梦）的分镜语言与用户输入原文一致。
   creative `_style_with_language_directive()` 按 `_is_external()` 传入该开关。
   **中文输入修正**：非外部模式对中文输入无指令（`external=False` 仍返回空串）；
   外部模式不再提前返回，改为显式钉住中文——否则默认 en meta-prompt（language
   pinning）叠加英文 style 会把中文 idea 的故事/分镜写成英文（2026-10-15 实测复现，
   该指令同时作用于 develop_story 与 write_script 两步）。

### 4.2 keep-audio 接线收口（P0/P2 实际落点）

- 三态判定与合成入口见 §五；下游守卫统一收在 `BasePipeline`：
  - `_keeps_video_audio()`：`execution_mode=="external"` 且 `audio_source=="video"`；
  - `resolve_segment_durations(video_paths, fallback)`：keep-audio 时用 `ffprobe` 真实时长替换计划时长；
  - `_recover_sub_maker()` 与 `_generate_audio_with_fallback()` 在 keep-audio 时短路（不采 cues、不落静音轨）；
  - `_maybe_pause` 在 `checkpoint == "audio"` 时短路（不暂停）。
- 调用点：creative [`_step_subtitle`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/creative/steps_audio.py) /
  manuscript [`_generate_subtitles`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/manuscript_video.py) /
  poetry [`_generate_subtitles`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/poetry_video.py)
  在 keep-audio 时传 `audio_path=""` 并以各分镜真实时长为分段时长。

### 4.3 v7.6 收口补丁（approve 校验 / 不产音频 / 字幕来源）

> 2026-10-15 三项修复，不改变既有契约，仅补齐外部素材模式的边界行为。

1. **`videos` 检查点 approve 前校验磁盘产物**（[video_routes.py](file:///Users/lcy/video/agnes-video-generator/web/routes/video_routes.py)
   `_validate_external_videos`）：`confirmed=true` 时，若 `execution_mode=external` 且
   `checkpoint=videos`，按 `_resolve_scene_target(task_type, "video", {}, i)` 逐场景算期望相对路径
   （creative→`scene_{i}/video.mp4`、manuscript→`para_{i}/video.mp4`、anchor→`clip/clip.mp4`；
   场景数取 `scene_count`，兜底 `len(scenes)`），缺失 → **422**（`checkpoint.approve.missing_videos`）。
   **不校验音轨**——视频是否含音轨由用户自行负责（导入回显会标黄提醒）。
2. **keep-audio 时本项目完全不产出音频**：`_generate_audio_with_fallback` 开头守卫
   `if self._keeps_video_audio(): return None`（覆盖全部调用点），**不写 `combined_narration.mp3`、
   不调 edge_tts、不采 cues**；字幕改按 `resolve_segment_durations` 的**真实时长**对齐
   （字幕步骤不依赖该 mp3）。
3. **新增「字幕来源」`subtitle_source`**（`narration` 旁白 / `dialogue` 人物对白，仅 external 生效）：
   - 模型：`ManualConfig.subtitle_source`（默认 `narration`）+ `SceneTask.dialogue`（默认 `""`）；
   - 创建端点（creative/manuscript/poetry/anchor）新增 `subtitle_source: str = Form("narration")`，
     非 external 忽略 / 强制 `narration`，非法值 → **422**（`validation.subtitle_source_invalid`）；
   - 对白生成：external + `dialogue` 时 creative 编剧阶段逐场景生成对白落 `scenes[].dialogue`
     （`Screenwriter.write_dialogues`），其余任务回退旁白（日志说明）；
   - `build_external_video_prompts` 在 external + `dialogue` 时于每场景块末追加
     「台词（对白）：<dialogue>」；
   - 字幕文本来源从 `state.narrations` 换成各场景 `dialogue`（空回退 narration）：
     creative `_step_subtitle` 与 multi_scene `_get_segment_texts_and_durations` 生效；
     时长 / 换行 / SRT 逻辑不变。

---

## 五、流水线增量

### 5.1 `_maybe_pause`（`core/pipelines/__init__.py`）

新增一条短路：`execution_mode == "external"` 且 `audio_source == "video"` 且 `checkpoint == "audio"` → **不暂停**。

### 5.2 合成层三态（P0，已实施）

| 条件 | 路径 |
|------|------|
| `audio_config.enabled and 音频文件存在` | `concat_videos_with_audio_overlay`（现状，替换音轨） |
| `not audio_config.enabled and 字幕开 and SRT 存在` | **`concat_videos_keep_audio`**（新增，保留原音轨 + 烧字幕） |
| 其余 | `concat_videos`（现状） |

新增合成入口（`core/compositor/concatenator/audio_overlay.py`）：

- `concat_videos_keep_audio(video_paths, srt_path, output_path, subtitle_style, subtitle_styles_path)`：`concat_videos`（`-c copy` 保留音轨）→ 单条 ffmpeg `[0:v]subtitles=...[v]` + `-map "[v]" -map 0:a?` + `-c:a copy`（失败回退 AAC）→ 不做 `volume=1.5`、不做音频补静音对齐；
- `_burn_subtitle_keep_audio(...)`：上面单条 ffmpeg 的内部实现（返回 bool，失败降级为「仅拼接」以保音轨）；
- `concat_scenes_keep_audio(video_paths, srt_paths, output_path, style, styles_path)`：poetry 专用，`concat_videos_keep_audio` + `_merge_scene_srts`（按真实时长 offsets 合并）。

调用点：creative [`_step_concatenate`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/creative/steps_audio.py) / manuscript [`_composite_final`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/manuscript_video.py) / poetry [`_composite_final`](file:///Users/lcy/video/agnes-video-generator/core/pipelines/poetry_video.py)。

### 5.3 字幕估时对齐（P2，external + `audio_source=video`）

无 cues 可用（不再采 TTS cues），改按**场景真实时长**估时：

- 素材：`scenes[i].narration_text`（creative 为 `_split_narration_into_scenes(narration, n)`）+ `duration = ffprobe(scene_i/video.mp4)`；
- 生成：`generate_subtitles_common(segment_texts, segment_durations, subtitle_config, sub_maker=None, audio_path="")` → 内部走 `text_to_srt`（无 cues 路径）；
- `sub_maker` 强制 None（`audio_source=video` 时不采 cues），保证时间轴按外部分镜时长而非 TTS 时长。

### 5.4 导入归一化（P1）

`utils/video.py` 新增 `normalize_external_video(src, dst, width, height, fps=30)`：

```
ffmpeg -i src -vf "scale=w:h:force_original_aspect_ratio=decrease,pad=w:h:(ow-iw)/2:(oh-ih)/2,setsar=1" \
  -r 30 -c:v libx264 -pix_fmt yuv420p -preset fast \
  -c:a aac -b:a 192k -ar 44100 -ac 2 dst
```

无音轨片段：`-an`（不补静音，交由合成层 `0:a?` 语义处理）。
图片归一化：写回 `scene_{i}/ref.png`（PIL 缩放到目标分辨率，等比 + 居中 pad）。

---

## 六、前端增量（P3）

1. **创建面板**：执行模式三选一 `⚡自动 / ✋手动 / 🌐外部素材`；选中外部素材展开「视频生成工具」下拉（`GET /api/providers` 拉取）+ 「音频来源」`使用视频自带音频（推荐）/ 使用本项目配音`；提交时带 `execution_mode=external&provider=jimeng&audio_source=video`。
2. **检查点页**：新增第四张卡片 `🎬 <工具名>协作`（`external_hint.prompt` 一键复制 + `fill_guide` + 「🔗 打开工具」链接 `provider.url`）；`videos` 检查点附「批量导入」入口（多选文件 → `POST .../artifacts/import`）与探针回显。
   - **`videos` 检查点特例**：进入即**默认选中协作卡片**并**隐藏其余操作方式卡片**（AI 帮改 / 自己改 / 外部 Agent / 在线编辑）——外部素材模式下这些通道无意义；卡片内「提示词」= 用户要粘贴进即梦的视频生成提示词（分镜脚本本身），并在下方给出「操作指引」（`fill_guide`）。
3. **「试验中」标识与官网说明链接**：即梦协作仍在试验阶段——创建面板的执行模式「🌐 外部素材」按钮旁、「视频生成工具」下拉标签、检查点「🎬 即梦协作」卡片均挂 `frontend/src/components/shared/ExperimentalBadge.vue`（key `experimentalBadge` / `experimentalBadgeHint`）；同一批位置给出官网新增的**使用说明**（`/guides/jimeng-workflow`）与**常见问题**（`/faq/jimeng`，含 Agnes 503 / queue is full 处理办法）链接，地址由 `frontend/src/utils/siteLinks.ts` 用「注册表下发的路径 + 当前 UI 语言」拼接，注册表拉取失败时回退即梦默认路径。
4. **i18n**：新增 key 同步写入 `frontend/src/i18n/langs/zh.json` 与 `en.json`（铁律，`scripts/i18n_check.py` 必须通过）。

---

## 七、兼容性与回归

1. `execution_mode` 缺省 `auto`、`audio_source` 缺省 `project` → 与 v7.5 完全一致。
2. P0 仅在 `audio_config.enabled == False and subtitle_config.enabled == True and SRT 存在` 时改变路径；此时**旧行为是注入静音轨**，新行为是保留原音轨（Agnes 片段本就无音轨 → 成片变为无音轨，属预期修正）。
3. 回归：8 场景矩阵不得回归；新增 `X1`（外部素材：即梦视频回填 + 字幕 + 保留音轨），
   见 `docs/dev/regression_test_plan.md` §十三（因服务端点表已占用 `E1`，场景改用 `X1`）。
4. 单测：`tests/test_external_assets.py`（注册表 + `render_prompt` + 导入映射 + 归一化/探针 +
   `_keeps_video_audio` + import/probe 端点端到端；合并覆盖原拟拆分的 `test_providers.py` /
   `test_concat_keep_audio.py`）。

---

## 八、改动文件清单

| 文件 | 改动 |
|------|------|
| `core/compositor/concatenator/audio_overlay.py` | +`concat_videos_keep_audio` / `_burn_subtitle_keep_audio` / `concat_scenes_keep_audio` |
| `core/pipelines/creative/steps_audio.py` | `_step_concatenate` 三态 |
| `core/pipelines/manuscript_video.py` | `_composite_final` 三态 |
| `core/pipelines/poetry_video.py` | `_composite_final` 三态（keep-audio 分支） |
| `core/providers.py` | **新增**注册表与提示词渲染 |
| `models/task.py` | `ManualConfig` 三字段 |
| `web/routes/task_creation_routes.py` | `execution_mode=external` + `provider` + `audio_source` |
| `web/routes/video_routes.py` | `external_hint` + `artifacts/import` + `artifacts/probe` |
| `web/routes/utility_routes.py` | `GET /api/providers` |
| `core/pipelines/__init__.py` | external 音频检查点自动通过（`_maybe_pause`）+ `_keeps_video_audio`/`resolve_segment_durations` + cues/静音守卫 |
| `utils/video.py` | `normalize_external_video` + `probe_media` |
| `utils/image.py` | `normalize_external_image` |
| `core/i18n_backend.py` | `validation.audio_source_invalid` / `validation.import_kind_invalid` / `validation.import_scene_map_invalid` / `artifacts.import_no_files` / `artifacts.probe_missing`（zh/en 双写） |
| `frontend/src/components/...` + `i18n/langs/{zh,en}.json` | 执行模式三选一 + 工具下拉 + 协作卡片 |
| `tests/test_external_assets.py` | **新增**单测（注册表 + 导入映射 + 归一化/探针 + keep-audio + 端点端到端） |
| `docs/dev/regression_test_plan.md` | +§十三 `X1` 场景与端点/单测补充 |
| `docs/public/manual_mode_guide.md` | +第五节「外部素材模式（即梦协作）」 |
