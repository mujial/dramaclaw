# v6.1「问题反馈」实施方案与路线图

> **文档定位**：根据 `issue_feedback_PRD.md`（v1.0）产出的**实施执行计划**。定义阶段划分、任务拆分、每任务的交付物与验证方式、状态跟踪约定。
>
> **关联文档**：`docs/plans/v6.1/issue_feedback_PRD.md`（方案权威）· `docs/dev/regression_test_plan.md`（回归）· `docs/dev/release_process.md`（发版）· `AGENTS.md`（验证清单 / 触发词）
>
> **版本**：v1.0（2026-08-25）
> **状态**：🟢 实施完成（P0–P5 全部完成；P5-T4 发版由用户触发）

---

## 一、总体原则

1. **严格分阶段**：按 §二 阶段表顺序实施，每阶段完成后更新状态（🟡→🟢），不得跨阶段跳跃。
2. **PRD 为准**：实现与 `issue_feedback_PRD.md` 保持一致；发现 PRD 不合理处，先改 PRD 再改代码。
3. **回归不破**：任何阶段不得破坏 `docs/dev/regression_test_plan.md` 现有 8 场景。
4. **i18n 铁律**：新增用户可见文案必须同时入 `zh` + `en` 区块；阶段内自检必须跑 `scripts/i18n_check.py`。
5. **文档随代码更新**：FAQ、release_process、回归计划、AGENTS.md 前缀表在对应阶段一并更新。
6. **Commit 规范**：英文 Conventional Commits；按阶段粒度提交，一个阶段 1~3 个 commit。

---

## 二、阶段划分与状态跟踪

| 阶段 | 名称 | 内容摘要 | 依赖 | 状态 |
|------|------|---------|------|------|
| P0 | 基座准备 | `APP_VERSION` 常量 + `/api/config` 字段 + `utils/clipboard.ts` + i18n 文案 key 骨架 | 无 | 🟢 |
| P1 | 重试引导闭环 | 失败重试计数持久化 + 失败面板「重试任务」按钮 + 引导文案 | P0 | 🟢 |
| P2 | 反馈区闭环 | `FeedbackPanel` 组件 + 诊断信息拼接 + 复制 + 确定性预筛 + 渐进展开 | P0/P1 | 🟢 |
| P3 | GitHub 与官网侧 | issue 模板 + 预填链接 + `faq.md`/`faq.zh.md` 更新 + `release_process.md` 补步骤 | P2 | 🟢 |
| P4 | 诊断端点（二期） | `error_collector` task_id 关联 + 任务时间戳 + `GET /api/tasks/{id}/diagnostics` + 前端合并 | P2 | 🟢 |
| P5 | 收尾与验收 | 回归条目 + AGENTS.md 更新 + 全量自检 + 发版准备 | P1–P4 | 🟢 |

> 阶段内容源自 PRD §四；验收对照 PRD §八逐条勾验。

---

## 三、任务拆分

### P0 — 基座准备（对应 PRD FR5.1 / FR8）

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P0-T1 | 新增 `APP_VERSION = "6.1.0"` 常量 | `core/config.py` | 可 import 读取 |
| P0-T2 | `/api/config` 响应增加 `app_version` 字段 | `web/routes/config_routes.py` | curl 返回含字段 |
| P0-T3 | 新增公共剪贴板工具 `copyText()`（clipboard + execCommand 降级） | `frontend/src/utils/clipboard.ts`（新建） | 类型检查通过 |
| P0-T4 | 收敛 3 处内联剪贴板实现为 `copyText()`（行为等价） | `PoetryForm.vue` / `ArtifactCard.vue` / `CheckpointDetail.vue` | 三处复制功能手工验证 |
| P0-T5 | i18n 文案骨架：PRD §五 全部 key 入 `zh` + `en` 区块 | `frontend/src/i18n/translations.ts` | `i18n_check.py` 退出码 0 |

**阶段自检**：`py_compile core/config.py web/routes/config_routes.py`；`cd frontend && npm run build`；`python scripts/i18n_check.py`；启动服务 `curl /api/config` 验证。

---

### P1 — 重试引导闭环（对应 PRD FR1）

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P1-T1 | 重试计数工具：`fb_retry_{taskId}` 读写 / +1 / 清理（任务成功时） | `frontend/src/composables/useProgress.ts` | 单测或手工验证跨刷新持久 |
| P1-T2 | `useProgress` 失败分支暴露重试入口：封装 `retryFailedTask()`（内部走 `resumeTask`，计数 +1，处理 400 分支） | 同上 | 失败任务点击后任务重新 running |
| P1-T3 | 失败面板加引导文案 + 「重试任务」主按钮 + 「已重试 N 次」计数展示（使用 P0-T5 文案 key） | `frontend/src/components/ProgressPage.vue` | UI 渲染正确，中英文切换正常 |

**阶段自检**：`npm run build`；mock 回归构造失败任务 → 点重试 → 状态恢复（或手工以无效 Key 触发失败后验证）。

---

### P2 — 反馈区闭环（对应 PRD FR2 / FR3 / FR4 / FR5）

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P2-T1 | 确定性预筛：关键词常量表 + 判定函数（429/超时类显式排除） | `frontend/src/utils/feedback.ts`（新建） | 单测覆盖命中/不命中用例 |
| P2-T2 | 诊断信息拼接器：按 PRD FR4 字段表生成 Markdown 报告（错误消息截断 2000） | 同上 | 单测覆盖字段完整性 |
| P2-T3 | `FeedbackPanel.vue` 组件：渐进展开（`RETRY_THRESHOLD=2` + `fb_open_{taskId}` 持久化）、诊断预览（可折叠）、复制按钮、隐私提示 | `frontend/src/components/FeedbackPanel.vue`（新建） | 展开策略三种路径均验证 |
| P2-T4 | 集成到失败面板：与重试引导区共存；确定性故障直接展开 + 文案切换 + 重试按钮弱化 | `ProgressPage.vue` / `useProgress.ts` | PRD §八验收 3、4 |
| P2-T5 | 前端类型补充（如需扩展 `TaskState` 读取字段） | `frontend/src/types.ts` | 构建通过 |

**阶段自检**：`npm run build`；新增 utils 的 vitest/pytest 等价单测（按项目现有测试方式，`tests/` 以 Python 为主，前端纯函数可用 node 脚本断言或留 CI 构建保障）；手工模拟失败验证三种展开路径。

---

### P3 — GitHub 与官网侧（对应 PRD FR6 / FR7）

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P3-T1 | 新增 issue 模板（版本/任务类型/失败环节/错误信息/重试情况/复现步骤/期望行为/补充日志） | `.github/ISSUE_TEMPLATE/bug_report.md`（新建） | GitHub 新建 Issue 页可见模板 |
| P3-T2 | Issue 跳转链接构造器：title 自动生成 + body 完整拼接 + 4000 字符截断 + 超长降级 + `labels=bug` | `frontend/src/utils/feedback.ts` | 单测覆盖截断与降级 |
| P3-T3 | FeedbackPanel 接入「去 GitHub 提 Issue」「先查看常见问题（官网 /faq）」按钮 | `FeedbackPanel.vue` | 实际点击验证预填与跳转 |
| P3-T4 | FAQ 更新：改写「如何获取帮助或报告问题？」+ 新增「生成失败了怎么办？」（中英双文） | `docs/public/faq.md` / `faq.zh.md` | 两条目齐全、链接有效 |
| P3-T5 | 发版流程补「同步更新 `APP_VERSION`」步骤 | `docs/dev/release_process.md` | 文档更新 |

**阶段自检**：手工验证 issues/new 预填（含中文编码）；FAQ 内部链接连通性。

---

### P4 — 诊断端点（二期，对应 PRD FR9）

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P4-T1 | `BaseTaskState` 增加 `created_at` / `updated_at`（默认值向后兼容；`TaskManager` 保存时刷新 `updated_at`） | `models/task.py` / `core/task_manager.py` | 旧数据加载正常；单测覆盖 |
| P4-T2 | `error_collector` 增加 `ContextVar` 承载 task_id；`record_error` 落盘 `task_id` 字段；`BasePipeline.run()` 入口 set | `core/api/error_collector.py` / `core/pipelines/__init__.py` | mock 回归后新日志含 task_id |
| P4-T3 | 新增 `GET /api/tasks/{task_id}/diagnostics`：精确匹配优先、时间窗口兜底；不含 prompt 全文与 response_body；日志前缀 `[Diagnostics]` | `web/routes/task_routes.py`（或新 route 模块） | curl 验证三种数据形态（有关联/仅窗口/无记录） |
| P4-T4 | 诊断端点单测 | `tests/` | CI 通过 |
| P4-T5 | `FeedbackPanel` 展开时拉取诊断并合并进报告（loading 态 + 失败静默降级） | `FeedbackPanel.vue` / `api/index.ts` | 端点正常/故障两种路径验证 |

**阶段自检**：`py_compile` 全部改动文件 + 关键模块 import；`./scripts/run_mock_regression.sh`；手工构造失败任务验证端点返回。

---

### P5 — 收尾与验收

| # | 任务 | 改动文件 | 验收 |
|---|------|---------|------|
| P5-T1 | 回归计划新增反馈模块条目（失败→重试→反馈路径） | `docs/dev/regression_test_plan.md` | 条目入库 |
| P5-T2 | `AGENTS.md` 更新：§6.1 登记 `[Diagnostics]` 前缀、版本信息、配套文档索引 | `AGENTS.md` | 与实现一致 |
| P5-T3 | 全量验收：PRD §八 12 条逐项勾验 | — | 全部通过 |
| P5-T4 | 发版：按 `docs/dev/release_process.md` 出 `release_notes_v6.1.0.md` + tag（**由用户触发**） | `docs/public/release-notes/` | 用户确认后执行 |

---

## 四、本地最小自检清单（每阶段收口执行）

```bash
# 后端（改动文件）
.venv/bin/python -m py_compile <改动文件>
.venv/bin/python -c "from core.api.error_collector import record_error; print('OK')"

# 前端
python scripts/i18n_check.py          # 退出码必须为 0
cd frontend && npm run build

# 服务冒烟
./start.sh                            # 另起终端
curl -s http://localhost:8765/api/config | python3 -m json.tool   # 含 app_version

# 涉及流水线时
./scripts/run_mock_regression.sh
```

---

## 五、建议执行顺序与里程碑

1. **P0 → P1 → P2 → P3** 为主线（一期闭环），完成后即可对外可用；
2. **P4** 为二期，不阻塞一期收尾，但同属 v6.1 发版范围；
3. **P5** 在 P1–P4 全部完成后统一收口；
4. 里程碑：一期闭环（P3 完成）→ 二期合并（P4 完成）→ 验收发版（P5）。
