# 开发计划与进度（TODO）

记录当前状态和已知的待办。状态：`✅ 完成` / `🚧 进行中` / `📋 待办` / `❌ 不做（明确排除）`。

---

## Jev 判断助手

### ✅ 完成

- 内核移植（engine / questions / draft / jevClient / adapter / pickText），对 WeFlow 零依赖。
- 接入层 `jevService` + IPC `jev:*` + preload 暴露。
- 前端三件套：`JevResultModal`、`SettingsPage` Jev 区、`ChatPage` 右键入口。
- 盲起草架构（判断结果不泄漏进起草 prompt）。
- 消融实验（30 用例 × 12 变体），三项验收门槛全部通过。
- 代码审查 7 项问题全部修复 + 3 项实测 bug 修复。
- 73 项单测，两个 tsconfig 类型检查全绿。

### 📋 待办

- **实测验证开关修复**：Jev 启用开关的类名 bug 已修并打进安装包，但因 desktop 控制会话锁死，
  没能实际点一下确认渲染。**下次会话用 computer-use 进设置页点一下开关，确认胶囊滑块可见可点。**
- **实测验证中文候选**：`norm()` 的中文修复已进安装包，但实测时用的还是旧包（返回空候选）。
  需要在新包上跑一次真实分析，确认中文对话能出 3 条候选。
- **消融实验发现的弱项跟进**：
  - `should_reply_now`（70%）和 `best_action`（73.3%）是最弱的两道题；`c24` / `c25` / `c20`
    用例反复错——**先复核标注本身是否合理**，再考虑改题面。
  - `BACKGROUND_NOTE` 在当前 fixture 集上无可测效果（fixture 无 D 阶段背景字段），
    **不能据此删掉**，需要补带背景字段的用例再测。
  - `state_no_rel`：只 -1.9pp 但 4 个翻转 / 0 个恢复，单向劣化——支持给 `relationship`
    一个合理默认值而不是留空。
- **`criteria` 文本精简**：去掉 criteria 解释文本省 ~39% input tokens，但会 -4.3pp 准确率。
  降成本应该从「少问题」入手（7 道题之间无交叉依赖），不是剥 criteria。

### ❌ 不做（明确排除）

- 自动发送候选回复（不发回车、不点发送、不调发信接口）。
- 碰转账 / 红包 / 收款。
- 把判断结果喂给起草模型（破坏盲起草）。

---

## 代码质量

### 📋 待办

- **既有类型错**：`tsconfig.node.json` 对全项目检查时报出一批非本次引入的类型错
  （`bizService.ts`、`chatService.ts`、`exportWorker.ts` 等）。目前用 `grep` 筛自己的文件，
  应逐步清理。
- **`electron/main.ts` 拆分**：单文件聚合了约 210 个 IPC 注册，体积巨大。新功能已不再往里塞，
  但既有的按域拆出去是较大的重构，按需排。
- **`chatService.ts` 拆分**：同上，约 1.6 万行。

---

## 文档

### ✅ 完成（2026-09-23）

- `AGENTS.md`、`docs/PROJECT-SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、
  `docs/COMPONENT-GUIDELINES.md`、`CHANGELOG.md`、`TODO.md`。
- README 充实。

### 📋 待办

- `docs/HTTP-API.md` 和 `docs/MAC-KEY-FAQ.md` 已存在且完整，但没在 README 里被引用——
  加一下交叉引用。
- Jev 的用户使用文档（面向最终用户，不是开发者）：什么时候该用、怎么配 key、判断结果怎么看。

---

## 优先级

1. 实测验证开关 + 中文候选（用户直接卡在这上面）
2. Jev 弱题复核（`should_reply_now` / `best_action` 的标注和题面）
3. 既有类型错清理
