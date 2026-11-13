# Agnes Video 2.5 Flash 接入调研

> 状态：**已实施（v6.2 落地：选模型差异说明 + 表单选项归拢 + 模型适配）**
> 日期：2026-08-26
> 目的：确认 `agnes-video-2.5-flash` 接口可用性，并梳理本项目接入所需的代码改动

## 实施记录（2026-08-26）

### 已落地改动

| 文件 | 改动 |
|---|---|
| `core/config.py` | 新增 `VIDEO_MODEL_CAPABILITIES` 三模型能力元数据 + `is_v25_video_model()` / `get_video_model_capabilities()` |
| `web/routes/config_routes.py` | `/api/models` 返回 `video_capabilities` |
| `core/api/agnes_video.py` | `submit_video()` 按模型分流：2.5 系列走 `mode/seconds/size/aspect_ratio` + reference/keyframe 映射；`_poll_task` 轮询带 `model_name` |
| `models/task.py` | `SimpleVideoTask` 新增 `video_size` 字段 |
| `web/routes/task_creation_routes.py` | simple 端点新增 `video_size`；2.5 系列时长校验放宽为 4–12s |
| `core/pipelines/simple_video.py` | 提交透传 `video_size` |
| `frontend/src/composables/useVideoModelCaps.ts` | 新增：模型能力读取 + 动态选项派生（mode/duration/ratio/size/negative/参考图上限） |
| `frontend/src/components/ConfigPanel.vue` | **开放视频模型选择** + 三模型差异对比表（选模型阶段详细说明） |
| `frontend/src/components/forms/SimpleForm.vue` | 顶部视频模型选择器（联动全局并自动保存）+ 按模型动态归拢选项（mode/duration/分辨率=比例+清晰度/negative 显隐）+ 当前模型能力说明卡片 |
| `frontend/src/i18n/translations.ts` | 22 语言补齐 `vm*` 系列 24 个 key |

### 验证结果

- 后端 payload 单测：flash t2v / 2.5 reference(1图) / keyframe(多图取首尾) 全部正确
- 端到端：`/api/models` 返回三模型 capabilities；切 2.5-flash 后创建 simple 任务（6s），走新协议提交 + `model_name` 轮询 → `completed`，下载 URL 正常
- `python scripts/i18n_check.py` ✅；`vue-tsc --noEmit && vite build` ✅
- 默认视频模型保持 `agnes-video-v2.0`，用户可在配置面板/简单视频表单选择 2.5 或 2.5-flash

## 一、结论摘要

1. **新模型已可用**：平台 `/v1/models?all=true` 已返回 `agnes-video-2.5` 与 `agnes-video-2.5-flash`，二者**限时免费**（720P `$0/秒`）。
2. **接口可用性已验证**：实际创建并跑通一条 4 秒 text 模式视频任务（约 34 秒完成），返回标准 `url`。
3. **不能直接切换**：用现有 v2.0 参数（`width`/`height`/`num_frames`）提交 2.5 flash 返回 **400 `"height is a forbidden field"`**，参数协议不兼容，必须按模型 ID 分流适配。
4. **关键限制**：2.5 flash `size` 固定 `720P`、`seconds` 仅支持 `"4"`–`"12"`、keyframe 仅首尾帧、无 `negative_prompt`。

## 二、接口可用性验证记录

| 步骤 | 请求 | 结果 |
|---|---|---|
| 模型列表 | `GET /v1/models?all=true` | `video` 分组含 `agnes-video-2.5` / `agnes-video-2.5-flash` / `agnes-video-v2.0` |
| 创建任务 | `POST /v1/videos`（`model=agnes-video-2.5-flash`, `mode=text`, `seconds="4"`, `size="720P"`, `aspect_ratio="16:9"`） | 200，返回 `video_id`/`id`=`task_xW9QvG1nrbwj45POFqDzXALvagU8ry4Q`，`status=queued` |
| 轮询 | `GET /agnesapi?video_id=...&model_name=agnes-video-2.5-flash` | `status=completed`（约 34s），返回 `url`（mp4） |
| 兼容性验证 | 用 v2.0 参数（`width`/`height`/`num_frames`）提交 2.5 flash | **400** `"height is a forbidden field"`，确认不兼容 |

> 参考图（reference）、首尾帧（keyframe）模式未实测，仅依据官方文档，实施时需补验。

## 三、参数差异（v2.0 vs 2.5 Flash）

| 维度 | 项目当前 v2.0 | 2.5 Flash |
|---|---|---|
| 分辨率 | `width` / `height`（任意） | `size` 固定 `"720P"` + `aspect_ratio`（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16） |
| 时长 | `num_frames` + `frame_rate`（24fps，最长 ~17s） | `seconds` 字符串 `"4"`–`"12"` |
| 文生视频 | 无参考图 → 纯 prompt | `mode: "text"` |
| 图生视频 | 1 图 → `image` + `mode: "ti2vid"` | `mode: "reference"` + `images[]`（≤5 张）+ `<Picture N>` 引用 |
| 关键帧 | 多图 → `extra_body.image` + `mode: "keyframes"` | `mode: "keyframe"` + `first_frame`/`last_frame`（仅首尾帧，至少一个） |
| 轮询 | `GET /agnesapi?video_id=X` | `GET /agnesapi?video_id=X&model_name=<model>`（text 模式可省略 model_name） |
| negative_prompt | 支持 | 文档未提及（视为不支持，丢弃） |
| seed | 支持 | 支持 |

## 四、代码改动清单

### A. 核心适配：`core/api/agnes_video.py`（必改，唯一协议层）

`submit_video()` 内按 `self.model` **分流两套参数体系**（v2.0 保持现有逻辑零回归）：

1. **时长映射**：`duration`（int 秒）→ `seconds` 字符串。`"4"`–`"12"`，超出 12 截断（或回退 v2.0，见风险 R1）。
2. **分辨率映射**：`width`/`height` → `aspect_ratio` 映射函数（宽>高 → 16:9，高>宽 → 9:16，近 1:1 → 1:1，21:9 / 4:3 / 3:4 按比例阈值）；`size="720P"` 固定。
3. **模式映射**：
   - 0 图 → `mode: "text"`
   - 1 图 → `mode: "reference"` + `images=[url]`
   - 2 图（首尾帧语义）→ `mode: "keyframe"` + `first_frame`/`last_frame`
   - >2 图 → 取首尾两张走 keyframe，或全量走 reference（≤5），需与创意流水线语义对齐（见 R2）
4. **丢弃** `negative_prompt`、`num_frames`、`frame_rate`（2.5 分支）。
5. **轮询**：`_poll_task()` 的 URL 追加 `&model_name={self.model}`（仅 2.5 系列）。
6. `wait_for_video()` 取 URL 字段（`url`/`video_url`）已兼容，无需改。

### B. 默认模型与配置：`core/config.py`

- `DEFAULT_VIDEO_MODEL`（L693）：**建议保持 v2.0 为默认**，通过配置/UI 手动切换 2.5 flash，避免流水线时长/分辨率行为被意外改变（见 R1/R3）。
- 模型下拉已自动包含 2.5 系列（`agnes_models.py` 按 `agnes-video*` 前缀归类），无需改。

### C. 流水线调用方（无需改代码，参数经 `submit_video()` 透传）

所有调用点均传 `width`/`height`/`duration`，适配层消化即可，但需核对各流水线语义：

| 调用点 | 模式 | 2.5 flash 映射 | 风险 |
|---|---|---|---|
| `simple_video.py:130` | t2v / 1图 / 首尾帧（0–2 图） | text / reference / keyframe | R1 时长档位、R4 分辨率档位 |
| `multi_scene.py:248`（模板基类） | 按 `_get_scene_ref_images` | 同上 | 泛用 |
| `creative/steps_video.py:189,302` | 1 图（角色/当前帧）i2v | reference | 正常 |
| `creative/steps_video.py:523` | 2 图 keyframes | keyframe | 语义正好匹配 ✓ |
| `manuscript_video.py:329` | 纯 t2v | text | R1 段落时长（拆段 5–12s 内，兼容） |
| `anchor_video.py:236` | 1 图 i2v（5s） | reference | 正常 |

### D. 前端：`frontend/src/`

- 简单视频 Tab 的**分辨率控件**（width/height 下拉）与**时长档位**（5/10/15/18/20s）：模型切到 2.5 系列时需动态切换为「比例（16:9/9:16/1:1…）+ 秒数（4–12）」。
- 其余 Tab 分辨率来自流水线默认值（映射函数消化），UI 可不改。

### E. 测试：`tests/`（mock 回归）

- mock API 增加 2.5 flash 新参数用例（`mode`/`seconds`/`size`/`aspect_ratio`、首尾帧 keyframe），确保分流逻辑有覆盖。

### F. 文档

- `AGENTS.md` 技术栈表、`docs/public/architecture.md`、`docs/plans/v6.0/optimization_roadmap.md` 中视频模型名补充 2.5 系列说明。

## 五、风险与决策点

| 编号 | 风险 | 说明 | 决策建议 |
|---|---|---|---|
| R1 | **时长上限 12s** | simple 视频 15/18/20s 档位、creative 长场景超 12s 会被截断或 400 | 截断到 12s；或超限时自动回退 v2.0；需产品决策 |
| R2 | **keyframe 仅首尾帧** | 若创意流水线存在 >2 张帧序列的 keyframes，2.5 不支持 | 取首尾两张；或改用 reference 模式 |
| R3 | **固定 720P** | 项目支持多种分辨率档位，2.5 只有比例没有绝对分辨率 | 比例映射 + 明示 UI 差异 |
| R4 | **aspect_ratio 枚举有限** | 非标准比例（如 3:2、2.39:1）无对应枚举 | 就近映射 + 提示 |
| R5 | reference/keyframe 未实测 | 仅依据官方文档 | 实施时用真实任务补验 |
