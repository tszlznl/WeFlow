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
- **Phase 0：共享决策层**（见下）。

### ✅ Phase 0：共享决策层（2026-09-23）

把判断能力从「回复建议专用」拆成可复用原语，所有后续功能（消息标注 / 待办 / 日记 / Agent）
的共同前置：

- `jev/decide.ts` — 纯决策函数 `(state, questions, config) → {answers, usage}`。不起草、
  不排序、无状态、无缓存，`askFn` 桩注入可不联网测。
- `jev/packs.ts` — `QUESTION_PACKS` 题集注册表；现有 7 道判断题 + 候选排序题收录为 `reply`。
  加新功能 = 注册一个题集。
- `decisionCacheService.ts` — 按 `(pack, session, messageKey)` 缓存答案，默认 7 天过期，
  `cacheMapStore` 的内存 Map + 防抖落盘范式。decisions 按调用收费，高频读场景靠它不重复花钱。
- `engine.analyze()` 变为 `decide + 起草 + 排序` 的便捷组合，**回复建议行为不变，73 项旧测试全过**。
- 24 项新单测（`npm run test:jev:packs`）：decide 透传 / 无 key 拒绝 / 注册表 / 缓存去重过期。

### ✅ Phase 1：回复建议深化（2026-09-26）

三个子功能，全部只读、不自动发送：

- **分层起草** — `draft.ts` 的 SYSTEM_PROMPT 重写：候选覆盖「认错 / 给方案 / 共情承认」
  三种姿态，保留原有反模板规则；群聊分支（不 @ 别人）。
- **「为什么是这条」** — `buildStanceQuestions()` 给每条候选单独标一道做法类型题
  （`reply_a_stance` / `reply_b_stance` / `reply_c_stance`），和排序题同一次 decisions
  调用，**不额外花钱**。`JevResultModal` 每条候选显示做法标签；和全局 `best_action` 一致时
  高亮 + tooltip 说明「这是它排第一的原因」。
- **右键「该回吗」** — 轻量入口，只跑 `shouldReply` 题集两道题（不起草、不排序、不收
  贵的 `danger_level`）。`jevService.quickDecide()` + `jev:quickDecide` IPC + preload；
  结果钉在右键光标处的小卡片（建议现在就回 / 先别急着回 + 把握 + 对方需要什么），
  8 秒自动消失，点页面任意处或 ✕ 关闭。答案进 `decisionCacheService`，同一条消息二次右键不花钱。
- 共享标签层：`src/jevLabels.ts`（true_intent / best_action / she_needs 的中文映射），
  `JevResultModal` 和 `ChatPage` 共用，不再各存一份。
- 15 项新单测（`npm run test:jev:phase1`）： stance 题结构 + `shapeQuickVerdict` 的
  noul→二结论整形（含否定态把握 = 1-v）。**112 项测试全过**（73 旧 + 24 packs + 15 phase1）。

### 📋 待办

- **跑一次 background 探针**：`JEV_JUDGE_KEY=… npm run test:jev:bg-probe`。
  结论决定背景信息（联系人备注 / 知识库命中）怎么接——`ACCEPTED AND READ` 才能按计划
  加 `state.background`；`ACCEPTED BUT IGNORED` 得折进 `chat.relationship`。**结论写回本文件。**
  注意：`background` 在两个 Python 版里都**只是设计意图**（build_state 从没接过它），
  这是新功能不是移植缺口。
- **实测验证开关修复**：Jev 启用开关的类名 bug 已修并打进安装包，但因 desktop 控制会话锁死，
  没能实际点一下确认渲染。**下次会话用 computer-use 进设置页点一下开关，确认胶囊滑块可见可点。**
- **实测验证中文候选**：`norm()` 的中文修复已进安装包，但实测时用的还是旧包（返回空候选）。
  需要在新包上跑一次真实分析，确认中文对话能出 3 条候选。
- **消融实验发现的弱项跟进**：
  - `should_reply_now`（70%）和 `best_action`（73.3%）是最弱的两道题；`c24` / `c25` / `c20`
    用例反复错——**先复核标注本身是否合理**，再考虑改题面。
  - `BACKGROUND_NOTE` 在当前 fixture 集上无可测效果（fixture 无 D 阶段背景字段），
    **不能据此删掉**，需要补带背景字段的用例再测（依赖上面的探针结论）。
  - `state_no_rel`：只 -1.9pp 但 4 个翻转 / 0 个恢复，单向劣化——支持给 `relationship`
    一个合理默认值而不是留空。
- **`criteria` 文本精简**：去掉 criteria 解释文本省 ~39% input tokens，但会 -4.3pp 准确率。
  降成本应该从「少问题」入手（7 道题之间无交叉依赖），不是剥 criteria。

### 后续阶段（已定：待办/日记先做轻量版，Agent 先做命令式）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 1 | 回复建议深化（分层起草 + 「为什么是这条」+ 右键「该回吗」只跑 decide） | 0 ✅ → **1 ✅** |
| 2 | 聊天信息标注（按需扫描 + decisionCacheService 缓存徽标） | 0 ✅ |
| 3 | 待办（todoPack + todoService + 消息反链，**先塞进 InsightInbox**） | 0, 2 |
| 4 | 日记（diaryPack + 复用摘要器，**先出只读每日总结**） | 0, 3 |
| 5 | Agent（agentPack + 工具表 + 有界循环 + 确认门，**先做命令式入口**） | 0–4 |

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
