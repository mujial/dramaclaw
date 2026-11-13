# v6.1「问题反馈」方案（PRD）

> **状态**：✅ 方案已确认（2026-08-25）；🟢 **实施完成**（P0–P5 全部完成，见 `implementation_plan.md` 状态行；v6.1 已发布）
> （修订 2026-10-15：原状态行仅写「待实施」，与 `implementation_plan.md` 的「🟢 实施完成」及 `AGENTS.md` 记载矛盾，更正为已实施。）
> **版本**：v1.0（2026-08）
> **关联文档**：`AGENTS.md` · `docs/plans/v6.1/implementation_plan.md`（实施路线图）· `docs/dev/release_process.md`（发版规范）· `docs/public/faq.md` / `faq.zh.md`（官网 FAQ 来源）· `docs/dev/regression_test_plan.md`（回归）
> **定位**：v6.1 中版本更新的**需求与方案文档**，覆盖「任务失败问题反馈模块」全部功能（含二期诊断端点）。实施拆分见 `implementation_plan.md`。

---

## 一、背景与目标

### 1.1 背景与问题

当前任务失败时，进度页仅显示一行 `current_message` 文案（`ProgressPage.vue` 失败面板），存在四个问题：

1. **用户无行动路径**：失败后不知道该怎么办，既没有重试入口，也没有反馈入口。
2. **偶发故障噪音大**：Agnes 免费模型调用存在一定比例的偶发失败（429 限流、网络超时、服务波动）。用户遇到偶发错误直接上报，维护者难以复现，issue 噪音高；而实际上项目已有断点续传机制（`POST /api/tasks/{id}/resume`，artifacts/checkpoint 支持），重试即可自愈，但失败态没有暴露该能力。
3. **上报信息质量低**：没有结构化诊断信息，用户手动描述环境与错误，issue 中常缺版本号、任务类型、失败环节，维护者需反复追问。
4. **后端错误详情无出口**：`core/api/error_collector.py` 已将模型调用的详细错误（error_type / status_code / error_message / response_body 等）落盘到 `error_logs/`，但**未与 task_id 关联**，前端完全拿不到。

### 1.2 目标

1. **先重试、后上报**：失败面板优先引导用户重试（复用断点续传），避免偶发故障被直接上报；重试多次仍未解决再引导反馈。
2. **一键上报**：自动拼接结构化诊断信息，支持一键复制与一键跳转**预填好 title/body 的 GitHub Issue**。
3. **FAQ 双向引流**：应用内失败场景引导用户先到官网 `/faq` 自查；官网 FAQ 同步介绍应用内反馈能力，拦截常见问题。
4. **诊断详情打通（二期）**：`error_collector` 与任务关联，新增诊断端点向前端暴露该任务相关的模型调用错误详情。

### 1.3 非目标

- 不做应用内评论 / 讨论系统，反馈最终落地 GitHub Issues。
- 不做自动错误上报 / 遥测，**不主动上传任何数据**（隐私红线）。
- 不做自动重试，重试始终是用户显式动作。
- 不覆盖「任务创建失败」场景（此时无 task 实体，本期不做，后续可在 toast 挂 FAQ 链接）。

---

## 二、术语与定义

| 术语 | 定义 |
|------|------|
| **偶发故障** | 重试大概率自愈的失败：HTTP 429/5xx、超时、网络异常、模型服务波动等。 |
| **确定性故障** | 重试无效的失败：HTTP 400 参数/提示词错误、内容审核拦截、API Key 无效等。 |
| **诊断信息（报告）** | 失败时自动拼接的结构化文本（版本/任务/环节/错误/重试次数等），用于复制与 Issue 预填。 |
| **重试计数** | 按任务持久化在浏览器 localStorage 的重试次数，驱动反馈区渐进展开。 |
| **反馈区** | 失败面板内的问题反馈模块：诊断信息预览 + 复制 + FAQ 链接 + GitHub Issue 按钮。 |
| **确定性预筛** | 前端按错误文案关键词判定确定性故障，跳过重试引导直接展开反馈区。 |
| **诊断端点（二期）** | `GET /api/tasks/{id}/diagnostics`，返回任务关联的模型调用错误详情。 |

---

## 三、用户故事

- 作为用户，任务失败时我想知道是否值得重试，以免浪费时间反复提交。
- 作为用户，重试多次仍失败后，我想一键复制/提交带完整诊断信息的反馈，不用手动描述环境。
- 作为用户，遇到常见问题时我希望先被引导到 FAQ 自查。
- 作为维护者，我希望每个 issue 自带版本号、任务类型、失败环节、重试次数与模型错误详情，减少反复追问，且偶发故障已被重试引导过滤。

---

## 四、功能需求

> 优先级：**P0 = 一期（本次交付主体）**；**P1 = 二期（诊断详情，同属 v6.1 范围）**。

### FR1 失败面板重试引导（P0）

1. `ProgressPage.vue` 失败红色面板扩展：错误信息之下新增引导文案 + 主按钮「重试任务」。
2. 重试 = 复用现有 `resumeTask()` → `POST /api/tasks/{id}/resume`（该端点仅拒绝已完成任务，失败任务可直接续传，从失败环节断点继续）。**无需新增后端端点。**
3. 重试计数按 `taskId` 持久化：`localStorage` key `fb_retry_{taskId}`，每次点击重试 +1；任务成功后清理对应计数。
4. 重试的错误分支（并发占用 400 "Task is already running"、缺 API Key 等）复用现有 toast 提示路径。

### FR2 反馈区渐进展开（P0）

1. 反馈区包含：诊断信息预览（可折叠）、「复制诊断信息」、「查看常见问题（官网 FAQ）」、「去 GitHub 提 Issue」三个操作 + 隐私提示。
2. 展开策略（阈值常量 `RETRY_THRESHOLD = 2`，前端可调）：
   - `重试计数 < 2`：反馈区收为低强调提示行「多次重试仍未解决？反馈问题」，点击可手动展开；
   - `重试计数 ≥ 2`：反馈区自动展开，提示语切换为「已重试 N 次仍未解决，请携带诊断信息反馈」。
3. 手动展开状态持久化：`localStorage` key `fb_open_{taskId}`。
4. **不做硬阻断**：任何状态下用户均可手动展开反馈区。

### FR3 确定性故障预筛（P0）

1. 前端对 `current_message` 做保守关键词匹配（独立常量表，便于扩展）：命中确定性特征（如 HTTP 400/401/403、提示词不合规、内容审核、API Key 无效等）时，跳过重试引导、直接展开反馈区，并附说明文案「该错误可能是参数或内容问题，重试可能无效」。
2. 关键词表必须保证 429 / 5xx / timeout 类文案**不会**命中（偶发故障永远走重试引导）。
3. 确定性分支下重试按钮保留但弱化，不剥夺用户重试权利。
4. 预筛误判只影响引导顺序，不影响任何功能可用性。

### FR4 诊断信息拼接（P0）

| 字段 | 来源 | 说明 |
|------|------|------|
| 应用版本 | `/api/config`（FR8 `app_version`） | 如 `6.1.0` |
| 任务 ID | task state | |
| 任务类型 | `task_type` | simple / creative / manuscript / anchor / poetry / simple_image |
| 生成模式 | `mode` | 仅 simple 任务，无则省略 |
| 失败环节 | `current_step` | |
| 错误信息 | `current_message` | 截断 2000 字符 |
| 已重试次数 | localStorage 计数 | 维护者排查关键线索 |
| 关键配置 | task state | 分辨率 / 时长 / TTS 音色等（复用 ProgressPage 现有 `taskConfigs`） |
| 用户环境 | `navigator.userAgent` | 前端采集 |
| 模型调用错误详情 | 诊断端点（FR9，二期） | 二期合并进报告 |

报告为 Markdown 文本。**隐私规则**：

- 默认**不含**用户 prompt / 稿件 / 诗词原文，**不含** `response_body`；
- 页面附提示「提交前请检查内容」；
- 复制按钮复制**完整版**；URL 预填受长度限制截断（见 FR6）。

### FR5 一键复制与剪贴板工具收敛（P0）

1. 新增 `frontend/src/utils/clipboard.ts` 公共 `copyText()`（`navigator.clipboard` + `execCommand` 降级）。
2. 收敛现有 3 处内联实现（`PoetryForm.vue` / `ArtifactCard.vue` / `CheckpointDetail.vue`），行为保持不变。
3. 复制成功 toast：「已复制，请粘贴到 GitHub Issue 中」。

### FR6 GitHub Issue 引导（P0）

1. 新增 `.github/ISSUE_TEMPLATE/bug_report.md`：版本、任务类型、失败环节、错误信息、重试情况、复现步骤、期望行为、补充日志等小节。手动进 Issues 页的用户也受其约束。
2. 「去 GitHub 提 Issue」按钮打开：
   `https://github.com/lcy362/agnes-video-generator/issues/new?title=<urlencoded>&body=<urlencoded>&labels=bug`
   - title 自动生成，如 `[Bug] creative 任务在 video_gen 环节失败`；
   - body 由前端拼接完整骨架（模板结构 + 诊断信息 + 待用户补充的复现步骤占位），预填截断上限 **4000 字符**。
3. 超长降级：编码后超限则只带 title 跳转，并提示用户粘贴已复制的完整诊断信息。

### FR7 官网 FAQ 双向引流（P0）

1. **应用内 → 官网**：反馈区提供「先查看常见问题」链接 → `https://video.lichuanyang.top/faq`。
2. **官网 → 应用内能力**：更新 `docs/public/faq.md` 与 `docs/public/faq.zh.md`（直接发布为官网 `/faq`）：
   - 改写现有「如何获取帮助或报告问题？」条目：说明应用内失败面板支持一键复制诊断信息并跳转提 Issue；
   - 新增条目「生成失败了怎么办？」：偶发故障先点应用内「重试任务」（断点续传）→ 多次失败再使用一键反馈。

### FR8 版本号与环境信息（P0，后端）

1. `core/config.py` 新增 `APP_VERSION = "6.1.0"` 常量。
2. `GET /api/config` 响应新增 `app_version` 字段。
3. `docs/dev/release_process.md` 发布流程新增一步：发版时同步更新 `APP_VERSION`。

### FR9 任务诊断端点（P1，二期）

1. **关联改造**：`error_collector` 通过 `contextvars.ContextVar` 承载当前 `task_id`（在 `BasePipeline.run()` 入口 set），`record_error` 落盘时写入 `task_id` 字段。选择 contextvar 而非逐层传参，将改动面收敛到 API 模块内部。
2. **时间戳补齐**：`BaseTaskState` 新增 `created_at` / `updated_at`（默认值保证旧 `task_state.json` 向后兼容），供时间窗口匹配兜底。
3. **端点**：`GET /api/tasks/{task_id}/diagnostics` 返回：
   - 任务摘要（状态 / 环节 / 错误消息）；
   - 关联的模型调用错误列表（优先 `task_id` 精确匹配，兜底时间窗口匹配；字段：timestamp / model_type / api_method / error_type / status_code / error_message / retry_count，**不含 prompt 全文与 response_body**，error_message 截断）。
4. **前端合并**：`FeedbackPanel` 展开时拉取诊断端点，合并进报告（带 loading 态）；端点失败 / 404 时**静默降级**为纯前端版报告，不阻断反馈流程。

---

## 五、交互与文案

失败面板结构（自上而下）：

```
┌─ 失败信息（现有红色面板）───────────────────────┐
│ ✕ 生成失败                                       │
│ <错误消息>                                       │
│                                                  │
│ 💡 偶发因素引导文案（确定性故障时替换文案）        │
│ [ 重试任务 ]（主按钮）   已重试 N 次              │
├─ 反馈区（渐进展开）──────────────────────────────┤
│ 「多次重试仍未解决？反馈问题 ▸」（收起态）        │
│ 展开后：                                         │
│  引导语（按重试次数切换）                         │
│  诊断信息预览 <pre>（可折叠）                     │
│  [复制诊断信息] [先查看常见问题] [去 GitHub 提 Issue] │
│  🔒 提交前请检查内容（不含您的提示词原文）         │
└──────────────────────────────────────────────────┘
```

关键文案（中文初稿，英文实现时补齐，全部走 i18n）：

| key | 文案（zh） |
|-----|-----------|
| `fbRetryHint` | 生成失败可能由模型服务波动、网络超时或限流等偶发因素导致，建议先重试（将从失败环节断点续传） |
| `fbRetryBtn` | 重试任务 |
| `fbRetriedN` | 已重试 {n} 次 |
| `fbCollapsedHint` | 多次重试仍未解决？反馈问题 |
| `fbExpandedHint` | 已重试 {n} 次仍未解决，请携带诊断信息反馈 |
| `fbDeterministicHint` | 该错误可能是参数或内容导致的确定性问题，重试可能无效，建议直接反馈 |
| `fbDiagTitle` | 诊断信息 |
| `fbCopy` | 复制诊断信息 |
| `fbCopied` | 已复制，请粘贴到 GitHub Issue 中 |
| `fbFaq` | 先查看常见问题 |
| `fbGithub` | 去 GitHub 提 Issue |
| `fbPrivacyHint` | 提交前请检查内容（不包含您的提示词原文） |
| `fbUrlTooLong` | 预填内容过长已省略，请粘贴刚才复制的完整诊断信息 |

---

## 六、边界情况与降级

| 场景 | 处理 |
|------|------|
| 重试时任务已在运行 | 后端 400 "Task is already running" → toast 提示 |
| 缺少 API Key | resume 400 → toast，引导先配置 Key |
| 重试成功 | 正常流程，清理该任务重试计数 |
| localStorage 被清空 | 计数丢失等同新失败，重新引导，无副作用 |
| Issue URL 超长 | 降级为仅带 title 跳转 + 提示粘贴复制内容 |
| 诊断端点失败（二期） | 静默降级为纯前端版报告 |
| 旧任务数据缺新字段 | Pydantic 默认值向后兼容（含 `created_at`/`updated_at`） |
| 确定性预筛误判 | 重试按钮保留（弱化），用户可自由重试与反馈 |
| 历史失败任务（事后从列表点入） | 进入进度页同样触发失败面板，流程一致 |

---

## 七、非功能需求

1. **i18n**：所有新增用户可见文案入 `translations.ts` 的 `zh` + `en` 区块（缺一不可，其余 20 语言回退 zh），`scripts/i18n_check.py` 通过 + `npm run build` 成功。
2. **隐私**：无任何数据主动上传；诊断信息仅在用户本地拼接，由用户自行复制/提交。
3. **日志前缀**：诊断端点相关后端日志使用 `[Diagnostics]` 前缀，完成后同步登记 `AGENTS.md` §6.1。
4. **向后兼容**：`/api/config` 新增字段不破坏现有前端；旧任务状态文件可正常加载。
5. **Commit 规范**：英文 Conventional Commits（项目铁律）。

---

## 八、验收标准

1. 失败任务面板显示重试引导与「重试任务」按钮，点击成功触发 resume（任务重新 running），计数 +1。
2. 重试计数跨页面刷新保持；任务成功后计数清零。
3. 重试计数 < 2 时反馈区为收起提示行；≥ 2 自动展开；两种状态均可手动展开/收起且状态持久化。
4. `current_message` 命中确定性关键词时直接展开反馈区并显示确定性文案；429/超时类文案不命中。
5. 「复制诊断信息」复制完整 Markdown 报告（含全部 FR4 字段 + 重试次数），并弹出成功 toast。
6. 「去 GitHub 提 Issue」打开预填 title/body 的 issues/new 页面；超长时降级且不报错。
7. 「先查看常见问题」跳转官网 `/faq`。
8. `faq.md` / `faq.zh.md` 完成更新（改写报告问题条目 + 新增「生成失败了怎么办？」）。
9. `GET /api/config` 返回 `app_version: "6.1.0"`。
10. （二期）诊断端点返回任务关联错误详情并合并进报告；构造端点故障时前端降级正常。
11. `scripts/i18n_check.py` 退出码 0；`npm run build` 通过；改动文件 `py_compile` 通过；mock 回归全通过。
12. `docs/dev/regression_test_plan.md` 新增反馈模块回归条目；`docs/dev/release_process.md` 含 `APP_VERSION` 步骤。

---

## 九、可选增强（不计入本期验收）

- **行为埋点**：复用 `useGa` 增加 `feedback_retry_click` / `feedback_open` / `feedback_issue_click` 事件，用于验证偶发故障拦截效果。
- **多语言文案补齐**：其余 20 种语言的反馈文案翻译（当前回退 zh）。

---

## 十、风险

| 风险 | 缓解 |
|------|------|
| GitHub 预填 URL 编码 / 截断边界问题 | 4000 字符上限 + 降级路径 + 手工验证多语言字符 |
| 确定性关键词误拦偶发故障 | 关键词白名单保守化，429/超时类显式排除；重试按钮不消失 |
| 剪贴板公共化重构影响既有 3 处功能 | 行为等价替换 + 手工回归三处复制入口 |
| contextvar 关联改造影响 API 调用路径 | 二期单独阶段实施，mock 回归覆盖；端点失败全降级 |
| 时间窗口匹配串入其他任务的错误日志 | 精确匹配优先；展示时标注来源，报告由用户提交前自查 |
