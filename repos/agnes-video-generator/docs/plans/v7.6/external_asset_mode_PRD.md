# 「外部素材模式」（即梦协作）初步方案（PRD 草案）

> **状态**：🟡 初步方案（PRD 草案），待评审确认后细化
> **版本**：v0.2（2026-10-15，新增「视频生成工具」选择器与工具注册表）
> **关联文档**：`AGENTS.md` · `docs/plans/v6.0/manual_mode_PRD.md`（手动模式，本方案是其增强版）· `docs/dev/pipeline_products.md`（产物逻辑权威参考）· `docs/dev/agnes_video_upstream_behavior.md`
> **定位**：本文档为「外部素材模式」的**需求与方案草案**。按项目流程，评审通过后进入 `system_design.md` 增量设计再实施。

---

## 一、背景与目标

### 1.1 背景

- 上游 Agnes 视频接口**不产出可用音频**，本项目因此自建 edge_tts 配音链路（TTS + 词级 cues + 字幕）。
- 即梦（Dreamina，Seedance 系列）视频模型**支持生成原生音频**，用户实测音频质量**优于** Agnes + edge_tts 方案，且每天赠送积分可用。
- 用户诉求链路：**本项目出分镜 prompt → 即梦生成分镜图 / 带音频视频 → 回本项目拼接、加字幕（可选加配音）**。即梦承担「画面 + 音频」（质量更高的强项），本项目承担「编排 + 字幕 + 合成」。
- 现状阻碍：本项目合成逻辑在「字幕开」时会无条件生成静音轨并走 overlay 路径，**丢弃外部视频自带音轨**（详见 §3.1）。需先修正该逻辑。

### 1.2 目标

1. **逻辑修正**：不加配音时不再生成/叠加静音轨，**保留视频自身音轨**，仅叠加字幕。
2. **即梦适配流程**：作为**手动模式的增强版**，在每个检查点提供**即梦专用提示词**，用户复制到即梦生成后回填产物。
3. **音频与时间轴同步**：即梦生成音频时，同步产出**字幕时间轴**（或使音频时长受提示词约束，供本项目按段估时对齐）。

### 1.3 非目标（第一期）

- 不接入即梦 API（无官方开放接口，仍走"人工复制提示词 + 手动回填产物"）。
- 不做 ASR 自动转写（第一期以"时长约束 + 估时对齐"为主，ASR 列为增强项）。
- 不做即梦素材的自动抓取/下载（用户手动导出）。
- 不改变自动模式既有行为。

---

## 二、命名与信息架构（本方案先决项）

### 2.1 命名建议

| 候选 | 定位 | 评价 |
|------|------|------|
| **外部素材模式**（External Asset Mode） | 通用：任何外部工具产出的画面/视频回填 | ✅ **推荐主名**。与具体厂商解耦，未来可接其他工具 |
| 即梦协作模式 | 绑即梦 | 直观但不可扩展；不适合作模式名 |
| 外源模式 | 通用 | 过简，含义不清 |
| BYOC（Bring Your Own Clips） | 通用 | 英文缩写不利于中文用户 |

**推荐**：
- **模式名**：`外部素材模式`（英文 `external_asset`，代码字段值）；
- **工具选择**：模式内提供 **「视频生成工具」** 选择器（首期仅「即梦」一项，见 §2.4）；
- **工具引导名**：检查点内提示词卡片的标题**随所选工具变化**（选即梦 → 「即梦协作」，将来选可灵 → 「可灵协作」），**不写死任何厂商**。

### 2.2 与手动模式的关系

外部素材模式 = **手动模式的增强版**，共享同一套暂停 / approve / 依赖图 / resume 机制，仅在三处不同：

1. **产物来源**：画面/视频由外部工具生成后**回填**（而非本项目调用 Agnes 生成）。
2. **音频来源**：默认 `音频来源 = 视频自带`（跳过 TTS），可选叠加本项目配音。
3. **提示词**：每个检查点额外提供**面向外部工具的提示词**（即梦专用）。

> 实现上不新增执行引擎：`execution_mode` 增加第三值 `external`（或 `manual` + `asset_source="external"` 子开关，见 §2.3）。

### 2.3 UI 位置建议

**创建面板（推荐方案）**：执行模式由「自动 / 手动」二选一，扩展为三选一：

```
执行模式：  ⚡ 自动    ✋ 手动    🌐 外部素材
```

- 选中「外部素材」后，展开：
  - **视频生成工具**：下拉单选，**首期仅「即梦 Dreamina」一项**（可扩展，见 §2.4）；
  - **音频来源**：`使用视频自带音频（推荐）` / `使用本项目配音` / `两者都加（混音）`；
  - **字幕**：`是 / 否`；
  - 提示文案："画面与音频由所选外部工具生成，回填后本项目负责拼接与字幕。各检查点会给出可直接复制到该工具的提示词。"

**备选方案**：保持二选一，在「手动」选中后增加开关 `🌐 画面由外部工具生成` + 工具下拉。优点是复用现有 UI；缺点是模式语义藏在二级开关里，用户不易发现。

**检查点页**：在现有「三通道卡片」（🤖 AI 帮我改 / ✏️ 我自己改 / 🤝 外部 Agent）之外，`scenes` / `references` / `videos` 检查点**新增第四张卡片** `🎬 <工具名>协作`（如「🎬 即梦协作」，含该工具提示词一键复制 + 回填指引）；`audio` 检查点在外部音频模式下**不暂停**（自动通过），`subtitle` 保留。

### 2.4 视频生成工具选择器（Provider Selector）

外部素材模式需要一个**「视频生成工具」**选择位置；首期只有「即梦」一个选项，但结构必须**可扩展**——新增工具 = 加一条注册表项 + 一套提示词模板，不改流程代码。

**首期选项**：`即梦（Dreamina / Seedance）` —— 支持原生音频、可约束时长。

**工具注册表（声明式）**：

| 字段 | 说明 |
|------|------|
| `id` | 工具标识，如 `jimeng` |
| `name` / `icon` | 显示名与图标（前端选择器用） |
| `capabilities` | `native_audio`（原生音频）/ `duration_control`（时长可控）/ `subtitle_export`（可导出字幕时间轴）/ `image_gen`（可出分镜图） |
| `checkpoint_prompts` | 各检查点的提示词模板（`scenes` / `references` / `videos` / `subtitle`），按该工具用法定制 |
| `fill_guide` | 回填指引（导出命名、目录、注意事项） |
| `notes` | 能力限制提示（如"固定 5s/10s 档位"） |

**流程对工具的依赖（按能力自动降级）**：

| 能力缺失 | 降级行为 |
|----------|----------|
| `native_audio` | 音频来源自动回退为 `本项目配音`（TTS） |
| `duration_control` | 字幕时间轴改用"按真实时长 offsets"对齐（精度下降，提示用户） |
| `subtitle_export` | 字幕走本项目估时 / 手工修正（§3.3） |
| `image_gen` | `references` 检查点改用本项目生成参考图 |

**可扩展性**：将来接入可灵 / Runway / 海螺 / Sora 等，仅需新增注册项与提示词模板；后端流程、检查点、合成层不变。第一期只实现 `jimeng` 一项，但**前后端接口一律按注册表设计**，避免后续返工。

---

## 三、核心需求

### 3.1 需求 A：不加配音时保持视频自身音轨（逻辑修正，P0）

**现状（问题定位）**：

- [steps_audio.py](file:///Users/lcy/video/agnes-video-generator/core/pipelines/creative/steps_audio.py#L457-L488) `_step_concatenate`：`has_audio = audio_config.enabled`、`has_subtitle = subtitle_config.enabled`；只要二者之一为真且 `combined_narration.mp3` 存在，就走 `concat_videos_with_audio_overlay`。
- 而「无配音」在本项目里**不是不生成音轨**，而是**生成静音轨当时间线**（[__init__.py](file:///Users/lcy/video/agnes-video-generator/core/pipelines/__init__.py#L876-L881) `SilentTTSEngine` 落盘 `combined_narration.mp3`）。
- [audio_overlay.py](file:///Users/lcy/video/agnes-video-generator/core/compositor/concatenator/audio_overlay.py#L294-L305) `_ffmpeg_mux_aligned` 用 `-map "[v]" -map "[a]"`，`[0:v]` **只取视频流** → **原音轨被丢弃**，替换为静音轨。

**结论**：`配音关 + 字幕开` 与 `配音开` 都会丢弃原音轨；只有 `配音关 + 字幕关`（走纯 `concat_videos`）才保留。

**需求**：`audio_config.enabled == False` 时**不得改动视频自身音轨**。

**方案**：

1. 新增合成入口 `concat_videos_keep_audio(srt_path, output, subtitle_style, ...)`：
   - 先 `concat_videos`（其 `-c copy` 已保留音轨）得到带音轨的拼接片；
   - 再用单条 ffmpeg 完成「烧字幕 + 音轨原样保留」：
     ```
     ffmpeg -i concat.mp4 -filter_complex "[0:v]subtitles=xxx.ass[v]" \
       -map "[v]" -map 0:a? -c:a copy -c:v libx264 -pix_fmt yuv420p out.mp4
     ```
   - **不做 `volume=1.5`**（该放大是 edge_tts 低音量的补偿，外部音轨不适用）；
   - 时长以视频为准（必要时 `-shortest`）。
2. `_step_concatenate` 分支改为三态：
   | 条件 | 路径 |
   |------|------|
   | `has_audio=True` | `concat_videos_with_audio_overlay`（现状，丢弃原音轨） |
   | `has_audio=False and has_subtitle=True` | **`concat_videos_keep_audio`（新增，保留原音轨 + 烧字幕）** |
   | `has_audio=False and has_subtitle=False` | `concat_videos`（现状） |
3. `has_audio=False and has_subtitle=True` 时，静音轨**仅用于字幕时间线**（`SilentTTSEngine` / `harvest_cues` 产物），**不进入最终 `-map`**；即合成步骤忽略该静音文件的存在。
4. 影响面：creative / manuscript / poetry 三处 `_step_concatenate`（anchor 已有 `model` 模式，另行对齐）；`simple_video` 若带字幕也需同规则。

> 该修正**独立于即梦**，对"任何外部带音频视频 + 加字幕"场景通用，是需求 B 的前置。

### 3.2 需求 B：外部素材流程（手动模式增强，以即梦为首个工具）

**流程（端到端）**：

```
创建（执行模式=外部素材）
  → [CP1 scenes]    本项目生成分镜脚本 + 【即梦提示词】（画面 + 台词/音频 + 时长约束）
        用户复制提示词到即梦 → 生成分镜图 / 视频（带音频）
  → [CP2 references] 回填即梦分镜图（自动归一化尺寸）
  → [CP3 videos]    回填即梦视频片段（自动归一化 分辨率/帧率/编码；音轨保留）
  → [CP4 audio]     （外部音频模式）跳过；若选「本项目配音」则在此生成
  → [CP5 subtitle]  生成字幕时间轴（按段落时长估时对齐，见 §4.2）
  → [CP6 final]     拼接（保留音轨）+ 烧字幕（可选混音）
```

**检查点产物矩阵（外部素材模式）**：

| checkpoint | 本项目产物 | 外部回填产物 | 暂停 |
|---|---|---|---|
| `scenes` | `script.json` / `prompts.json` + **即梦提示词** | — | ✅ |
| `references` | 参考图位（可空） | `scene_{i}/ref*.png`（即梦分镜图） | ✅ |
| `videos` | — | `scene_{i}/video.mp4`（即梦，带音轨） | ✅（**approve 前校验已导入**，缺失 → 422；音轨由用户自行负责） |
| `audio` | `combined_narration.mp3`（仅"本项目配音"时） | —（外部音频模式跳过） | 条件 |
| `subtitle` | `combined_narration.srt` | （可选）即梦侧字幕回填 | ✅ |
| `final` | `final_video.mp4` | — | ✅ |

> **keep-audio 不产音频**：选「使用视频自带音频」时，本项目**完全不产出音频**——不写
> `combined_narration.mp3`、不调 edge_tts、不采 cues（`_generate_audio_with_fallback` 开头守卫短路）；
> 字幕改按各分镜**真实时长**对齐，不依赖该 mp3。
> **字幕来源 `subtitle_source`**（仅 external 生效）：`narration`（旁白，默认）/ `dialogue`（人物对白）。
> `dialogue` 时 creative 编剧阶段逐场景生成对白落 `scenes[].dialogue`（其余任务回退旁白），
> `videos` 提示词每场景附「台词（对白）」，字幕文本取自各场景 `dialogue`（空回退 narration）。

**回填增强（P1）**：
- **批量导入**：一次选定即梦导出的多个 mp4 / png，按序号或 mtime 顺序映射到 `scene_{1..n}`（替代逐个上传）；
- **导入体检**：ffprobe 探针回显每片段的 时长 / 分辨率 / 帧率 / **是否有音轨** / 编码，异常给提示；
- **归一化**：统一到任务目标分辨率（`scale+pad/crop`）、统一帧率、统一 `libx264/AAC`，**音轨默认保留**（不含音轨的片段可按需补静音）。

### 3.3 需求 C：外部音频模式下同步生成字幕时间轴（P0）

**问题**：现有字幕精度依赖 edge_tts 词级 cues；改用即梦音轨后**无 cues**，时间轴来源需另立。

**方案（第一期，零新依赖）——「时长约束 + 估时对齐」**：
1. 在 CP1 的即梦提示词中，要求即梦**按提供的"分行台词 + 每句时长"生成音频**，使 `Σ句时长` 受控；
2. 本项目按 `script.json` 的 `narration_text` / `duration` 逐段估时，生成 SRT（复用现有无 cues 路径：`generate_subtitles_common(segment_texts, segment_durations)`，poetry / anchor 已在用）；
3. 多场景按 `_merge_scene_srts` 的 **offsets（真实视频时长累积）** 合并，保证与拼接后的实际时间轴一致。

**增强项（P2，可选）**：
- **即梦侧导出时间轴**：若即梦可导出字幕/SRT，则在 CP5 支持"回填 SRT"，跳过估时；
- **ASR 对齐**：引入本地 ASR（如 faster-whisper）从即梦音轨取词级时间戳——精度高，但引入模型依赖，与"轻量/免费"定位有张力，列为可选项。

---

## 四、合成层与流程细节

### 4.1 音频来源三态

| `audio_source` | 音轨处理 | 字幕 | 适用 |
|---|---|---|---|
| `video`（默认） | 保留视频自带音轨，**不生成 TTS** | 按段估时 | 即梦链路 |
| `project` | 丢弃原音轨，用本项目 edge_tts | cues 精确 | 现状默认 |
| `mix`（可选） | 原音轨 + 本项目 TTS 混音（原音轨降为"音效背景"） | cues 精确 | 需要旁白 + 环境声 |

> 另立**字幕来源** `subtitle_source`（仅 external 生效）：`narration`（旁白，字幕取 `state.narrations`）
> / `dialogue`（人物对白，字幕取各场景 `scenes[].dialogue`，空回退 narration）。`dialogue` 时
> `videos` 检查点提示词逐场景附「台词（对白）」，`subtitle` 检查点 SRT 文案随之为对白。

### 4.2 时长与对齐

- 外部音频模式下**以音轨/视频时长为准**（不再用 `max(video, audio)` 的音频补静音语义）；
- 字幕末端不超出音轨时长（沿用现有钳位逻辑）；
- 拼接多片段时**按真实时长累积偏移**生成总 SRT（同 `concat_scenes_single_pass` 的 offsets 思路）。

### 4.3 归一化（保证拼接走 fast path）

- 即梦产物常见 VFR + 非标尺寸（实测本条 704×1248 / `avg≈24.06` / `r=60`）。多片段拼接若要命中 `-c copy` fast path（[concat.py](file:///Users/lcy/video/agnes-video-generator/core/compositor/concatenator/concat.py#L102-L131)），必须**统一 width/height/avg_frame_rate**；
- 导入时归一化：目标分辨率（9:16 或任务 `video_width/height`）、统一帧率、统一编码；**音轨保留但统一采样率/声道**（`aresample`），否则 `-c copy` 带音轨拼接会失败或时间戳错乱。

---

## 五、外部工具协作提示词（按所选工具渲染，可一键复制）

> 占位由前端按真实任务目录/脚本填充；模板按工具注册表（§2.4）的 `checkpoint_prompts` 渲染，**与厂商解耦**——以下为 `jimeng`（即梦）模板集，将来新增工具只需补一套模板。
>
> **例外·CP3 `videos`**：该检查点给用户的应当是**用户要粘贴进即梦的「视频生成提示词」本身**（即本项目的分镜脚本，逐场景 + 时长），而非「去即梦操作、再把视频传回来」的流程说明。故 `videos` 的提示词**不由静态模板渲染，改由任务数据动态组装**（`web/routes/video_routes.py::build_external_video_prompts`：按 `scenes[].scene_prompt` → `script_file`（creative 分镜落在 `script.json`）→ `paragraphs` 的优先级取文本，逐场景编号并标注时长）；原工作流文案降级为**操作指引**（`fill_guide`，含「打开即梦」官网链接 `provider.url`）。前端在 `videos` 检查点**默认选中即梦协作卡片并隐藏其余操作方式卡片**（AI 帮改 / 自己改 / 外部 Agent / 在线编辑在此场景无意义）。

### CP1 `scenes`：分镜 + 音频脚本（含时长约束）

```
你是资深短剧分镜导演。请读取 <任务目录>/script.json，据此为即梦生成【画面+音频】的创作指令。

对每个场景，输出一段即梦提示词，包含三部分：
1. 画面：主体、构图、镜头运动、光线氛围、色彩基调（与前后场景视觉连续）；
2. 音频：明确要求"生成同步音频"，写清音频内容（对白/旁白/音效）与音色、语气；
3. 时长：给出该段的台词文本与目标时长（秒），要求即梦的音频时长与之一致。

约束：
- 每段台词的**文字与顺序必须与 script.json 的 narration_text 完全一致**（本项目据此生成字幕）；
- 每段目标时长与该场景 duration 一致；
- 输出 JSON：{"scene_index": n, "jimeng_prompt": "...", "dialogue": "...", "duration": n.nn}
```

### CP2 `references`：分镜图

```
请用即梦的文生图/图生图，按 <任务目录>/script.json 中每个场景的 scene_prompt 生成分镜图：
1. 保持角色外貌、色调、构图在场景间一致（建议先用首图作为参考图统一角色）；
2. 输出竖屏 9:16，导出 PNG；
3. 导出文件按 scene_1.png / scene_2.png … 命名，回填到 <任务目录>/scene_{i}/ref.png。
```

### CP3 `videos`：给即梦的「视频生成提示词」+ 回填指引

**提示词 = 本项目的分镜脚本本身**（任务数据动态组装，非静态模板），逐场景编号 `【场景 i/N · {dur}s】` 后附该场景画面描述，用户**直接复制粘贴进即梦**逐段生成。示例：

```
【场景 1/2 · 10s】
竖屏9:16构图，纪录片式自然光摄影，深夜卧室，主角坐在床边低头……

【场景 2/2 · 10s】
同一卧室环境（保持角色外貌/光线连续），主角起身推窗……
```

> 当 `subtitle_source=dialogue` 时，每个场景块末尾追加一行「台词（对白）：<scenes[].dialogue>」，
> 供用户把对白交给即梦并保证与成片字幕一致。

**操作指引（`fill_guide`，同时给出「打开即梦」官网链接 `provider.url`）**：

```
1. 点击「打开即梦」，新建视频生成任务；
2. 把上方提示词逐场景粘贴到即梦，开启"生成音频"，按各场景时长生成；
3. 导出 mp4，按 scene_1.mp4 / scene_2.mp4 … 命名；
4. 用「批量导入」回填（自动归一化分辨率/帧率/编码并回显体检结果），
   或手动放到 <任务目录>/scene_{i}/video.mp4。
```

### CP5 `subtitle`：时间轴

```
（第一期·估时对齐）
请确认 <任务目录>/combined_narration.srt 的每条字幕：
1. 文案与场景台词逐字一致；
2. 末条结束时间不超音轨时长；相邻不重叠（≥50ms 间隔）；中文单条 ≤18 字符；
3. 时间轴按各场景实际时长累积偏移，与拼接后视频对齐。

（增强·即梦可导出字幕时）
请从即梦导出字幕/时间轴文件，按 scene 顺序合并，回填到 <任务目录>/combined_narration.srt。
```

---

## 六、API 设计（草案）

| 端点 | 变更 |
|------|------|
| `POST /api/tasks/*`（创建） | 新增 `execution_mode="external"`；新增 `provider`（首期仅 `"jimeng"`，见 §2.4）；`audio_source`（`video`/`project`/`mix`）；`subtitle_source`（`narration`/`dialogue`，非 external 忽略，非法值 422）；`subtitle_enabled` |
| `GET /api/providers` | 返回外部工具注册表（§2.4）：id / name / icon / capabilities / 各检查点提示词模板 |
| `GET /api/tasks/{id}/checkpoints/{name}` | 检查点详情新增 `external_hint`（**按任务 `provider` 渲染**的提示词模板，占位已填充） |
| `POST /api/tasks/{id}/artifacts/import` | **批量导入**外部产物：`multipart` 多文件 + `kind`（`image`/`video`）+ `scene_map`；服务端归一化 + 探针回显 |
| `GET /api/tasks/{id}/artifacts/{id}/probe` | 单产物探针（时长/分辨率/帧率/音轨/编码） |
| 现有 `approve / regen / impact / mode` | 复用，不新增语义 |

---

## 七、兼容性与回退

1. **默认不变**：`execution_mode` 缺省 `auto`，`audio_source` 缺省 `project`（等价现状）。
2. **需求 A 的向后兼容**：仅当 `audio_config.enabled == False` 且 `subtitle_config.enabled == True` 时改走"保留音轨"路径；参数化确保旧任务/旧行为不变（8 场景回归须通过）。
3. **回退**：外部素材模式任一检查点异常可切回自动（沿用现有机切换）；音频来源可随时改为 `project` 回落到 TTS。
4. **回归门槛**：不得破坏 `docs/dev/regression_test_plan.md` 场景矩阵；新增 `E1`（外部素材：即梦视频回填 + 字幕 + 保留音轨）场景。

---

## 八、风险与开放问题

| # | 问题 | 建议 |
|---|------|------|
| O1 | 即梦导出的 mp4 是否**稳定保留音轨**？本研究实测样本无声 | 导入体检强制回显"有无音轨"，无音轨时提示用户重新导出 |
| O2 | 即梦音频时长是否严格受提示词约束 | 以实际时长为准（offsets），字幕按实际对齐；必要时允许用户在 CP5 手工修 SRT |
| O3 | 多片段音轨参数不一致导致 `-c copy` 拼接失败 | 导入时 `aresample` 统一采样率/声道；不一致则重编码音频（不重编码视频） |
| O4 | 即梦素材命名混乱，场景映射易错 | 提供 `scene_map` 显式映射 + 导入预览确认 |
| O5 | AIGC 合规标签随重编码丢失 | 如需合规留存，在最终成片重新注入 AIGC 元数据（列为可选） |
| O6 | 估时对齐精度不足（即梦语速 ≠ 4 字/秒） | 提供"估时系数"参数；或引导用户走 ASR/导出字幕（P2） |
| O7 | "混音"（原音轨 + TTS）增益平衡 | 第一期不做混音，仅提供 `video`/`project` 二选一 |

---

## 九、验收标准

1. **需求 A**：`audio_config.enabled=false` + `subtitle_config.enabled=true` + 外部带音轨视频 → 成片**保留原音轨**且字幕已烧录，无静音轨替代（ffprobe 校验音轨存在且非静音）。
2. **需求 A 不回归**：`audio_config.enabled=true` 任务行为与现状一致（8 场景回归通过）。
3. **需求 B**：`execution_mode=external` 创建任务 → `scenes`/`references`/`videos` 暂停并展示即梦提示词；回填即梦视频后 `approve` → 生成字幕 → 合成保留音轨。
4. **需求 B 归一化**：混合分辨率/帧率的即梦片段导入后，拼接命中 `-c copy` fast path（日志确认）。
5. **需求 C**：外部音频模式下生成 SRT，末条不超音轨时长、相邻不重叠、按场景偏移与拼接后时间轴一致。
6. **通道交互**：`scenes`/`references`/`videos` 检查点展示「🎬 即梦协作」卡片，提示词一键复制成功。
7. 自动模式与 v7.5 完全一致。

---

## 十、实施分期

| 阶段 | 内容 | 交付 |
|------|------|------|
| **P0** | 需求 A 逻辑修正：`concat_videos_keep_audio` + `_step_concatenate` 三态分支（creative/manuscript/poetry） | 不加配音即保留原音轨 |
| **P1** | 需求 B 骨架：`execution_mode=external` + **工具注册表 `provider`（首期 `jimeng`）+ 按工具渲染的提示词模板** + 检查点矩阵 + 批量导入/探针/归一化 | 即梦端到端跑通、工具可扩展 |
| **P2** | 需求 C：估时对齐字幕 + offsets 合并；（增强）工具导出字幕回填 / 可选 ASR | 字幕时间轴可用 |
| **P3** | 前端：执行模式三选一 + **「视频生成工具」下拉** + 音频来源选择 + 「🎬 <工具名>协作」卡片 + 导入体检回显 | 完整交互 |
| **P4** | 回归补 `E1` 场景 + 文档（`manual_mode_guide.md` 增补）+ 协作提示词库归档 | 交付文档 |

---

## 十一、后续步骤

1. 本草案评审：**命名**（§2.1）、**UI 位置**（§2.3）、**工具选择器与注册表粒度**（§2.4：能力字段是否第一版就全声明、是否需要"自定义工具"入口）、**音频来源三态取舍**（§4.1，是否第一期就做 `mix`）、**字幕时间轴策略**（§3.3）。
2. 评审通过 → `docs/plans/v7.6/system_design.md` 增量设计（模型/路由/流水线/合成改动清单）。
3. 按 P0 → P4 实施；P0 完成后即跑 8 场景回归 + 新增 `E1`。
