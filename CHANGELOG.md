# 更新记录（CHANGELOG）

格式：版本 + 日期，按功能域分组；`(docs)` 标文档变更。逆序排列，最新在上。

---

## Phase 1：回复建议深化 — 2026-09-26（未发版，main 分支）

回复建议从「给 3 条候选」升级为「给 3 条候选 + 每条为什么 + 该不该回」。全部只读，
不自动发送。**112 项测试全过**（73 旧 + 24 packs + 15 phase1），`tsconfig.json` 全绿。

### 新增

- **「为什么是这条」** — `buildStanceQuestions()`（`jev/questions.ts`）给每条候选单独
  标一道做法类型题，criteria 复用 `best_action` 的七个类型，标注口径和排序题一致；
  和排序题同一次 decisions 调用，**不额外花钱**。`JevResultModal` 每条候选显示做法标签，
  和全局建议做法一致时高亮，tooltip 说明这是排序依据。
- **右键「该回吗」** — `shouldReply` 题集（只 `should_reply_now` + `she_needs` 两道，
  故意不收贵的 `danger_level`）；`jevService.quickDecide()` + `jev:quickDecide` IPC +
  preload + 类型。答案进 `decisionCacheService`，同一消息二次右键不花钱。
  前端：钉在光标处的结论卡片（`ChatPage.tsx` + `ChatPage.scss`），8 秒自动消失，
  点页面任意处或 ✕ 关闭，卸载时清计时器。
- **共享标签层 `src/jevLabels.ts`** — true_intent / best_action / she_needs 的中文映射，
  `JevResultModal` 与 `ChatPage` 共用。
- `npm run test:jev:phase1` — 15 项：stance 题结构（键 / criteria / 候选数守卫）+
  `shapeQuickVerdict` 的 noul→二结论整形（含否定态把握 = 1-v、边界 0.5、缺字段默认）。

### 重构

- `draft.ts` SYSTEM_PROMPT 重写为分层起草（认错 / 给方案 / 共情承认），新增 `isGroup`
  分支（群聊只对目标说话、不 @ 别人）；`DRAFT_PROVIDERS` 显式带 `baseUrl`；
  起草失败时 key 先脱敏再进 error。
- `shapeQuickVerdict` 导出供单测直接打。

---

## Phase 0：共享决策层 — 2026-09-23（未发版，main 分支）

把 Jev 的判断能力从「回复建议专用」拆成可复用原语。这是后续消息标注 / 待办 / 日记 / Agent
功能的共同前置。**回复建议行为完全不变，73 项旧测试全过。**

### 新增

- **`electron/services/jev/decide.ts`** — 纯决策函数：`(state, questions, config) → {answers, usage}`。
  不起草、不排序、无状态、无缓存；`askFn` 桩注入可不联网测；无 key 时拒绝请求。
- **`electron/services/jev/packs.ts`** — `QUESTION_PACKS` 题集注册表。现有 7 道判断题 +
  候选排序题收录为 `reply`。加新功能 = 注册一个题集。
- **`electron/services/decisionCacheService.ts`** — 决策缓存，按 `(pack, session, messageKey)`
  去重，默认 7 天过期，`clearSession` / `clear`，照 `cacheMapStore` 的内存 Map + 防抖落盘范式。
  decisions 按调用收费，高频读场景靠它不重复花钱。
- **`jev/__tests__/jev.bg-probe.ts`** — 一次性探针：验证 decisions 端点是否真的读
  `state.background`（key 只进环境）。**在背景注入接数据之前必须跑一次。**

### 重构

- `engine.analyze()` 从「自己组装题集 + 调 ask」改为 `decide(replyPack) + 起草 + 排序` 的
  便捷组合；题集组装移到 `packs.ts`。外部调用方（jevService）无变化。

### 测试

- 新增 `npm run test:jev:packs`（24 项，不联网）：decide 透传 / 无 key 拒绝 / 注册表题集结构 /
  缓存去重与过期。新增 `npm run test:jev:bg-probe` 脚本。
- 两个 tsconfig 类型检查全绿；73 项旧测试全过。

### 事实更正

- `background` 字段**不是移植缺口**：核实两个 Python 版的 `build_state()` 都没接过它，
  jarvis 里只有一个探针脚本在测端点能否容忍。这是从未落地的设计意图，已降级为
  「先跑探针验证再接数据」，详见 `docs/ARCHITECTURE.md` 5.3 节。

### 文档 (docs)

- `docs/ARCHITECTURE.md` 第 5 节重写：拆成 5.1 共享决策层 / 5.2 回复建议 / 5.3 background 探针 /
  5.4 密钥与边界。
- `docs/DEVELOPMENT.md` 补 `test:jev:packs` 和 `test:jev:bg-probe` 两个脚本说明。
- `TODO.md` 记录 Phase 0 完成状态、探针待跑、后续阶段排期（待办/日记先轻量、Agent 先命令式）。

---

## 5.0.1 — 2026-09-23

### Jev 判断助手（新增）

从 Python 项目（jev-chat-jarvis / jev-chat-windows）移植的判断核心，作为对话副驾接入 WeFlow。
**它不是生成式 LLM 的封装**，而是调 TypeSafe 的 decisions 接口做结构化判断。

- **内核**（`electron/services/jev/`，对 WeFlow 零依赖，可单独测试）：
  - `engine.ts` — 对话 → 盲起草 3 条 → Jev 一次判断+排序 → 结构化结果
  - `questions.ts` — 7 道判断题 + 1 道排序题，`buildState` 对齐 Python `build_state`
  - `draft.ts` — 候选起草、去重、鹦鹉学舌过滤、提示词注入防护
  - `jevClient.ts` — TypeSafe 官方 / OpenRouter 双 provider，指数退避重试
  - `adapter.ts` / `pickText.ts` — WeFlow `Message` 到内核 `{from, text, name}` 的适配
- **接入层**（`electron/services/jevService.ts`）：配置读取（key 复用共享 AI 配置或独立配置）、
  会话取消息、调 `engine.analyze`。
- **前端**：`JevResultModal`（判断摘要条 + 危险等级 + 判断明细 + 候选复制）、
  `SettingsPage` 的 Jev 设置区（启用开关、关系设定、判断/起草两套接口配置、连接测试）、
  `ChatPage` 右键对方消息入口 + 聊天页头部按钮。
- **盲起草架构**：起草（chat/completions）与判断（decisions）分离，判断结果不进起草 prompt。
- **绝不自动发送**：候选只进剪贴板，全链路无发信调用。

### Jev 代码审查修复（agy review，7 项全部确认并修复）

- **[Critical] 「是否有潜台词」显示颠倒**：题面 `true` = 纯字面无潜台词，UI 却把 `noul >= 0.5`
  显示成「有潜台词」。交换 `noulText` 两端文本。（`JevResultModal.tsx`）
- **[High] 否定态概率显示错误**：`noulText` 和摘要条在选中否定结论时显示 `v` 而非 `1 - v`——
  模型 90% 认为「先别急着回」，界面却显示「先别急着回 5%」。统一按选中结论算把握。
- **[High] 密钥脱敏漏洞**：`truncate` / `describeError` 调 `redactKey` 没传 key，起草的
  `callApi` 报错完全未脱敏。`redactKey` 加 `sk-` / `apikey_` 格式正则兜底（网关可能在 4xx
  响应体回显 Authorization 头），起草报错统一包 `JevApiError`。
- **[Medium] 私聊被注入「这是群聊」指令**：右键起草在私聊里也给模型说「这是群聊、不要@别人」。
  改为按 sessionId 的 `@chatroom` 后缀判断，`DraftOptions.isGroup` 一路传下去。
- **[Medium] 两处类型错**（只在 `tsconfig.node.json` 暴露）：`questions.ts` 的 `reply_to` 赋
  `null` 但声明 `string`；测试给 `engine.analyze` 传元组而非 `JevMessage[]`。
- **[Medium] 危险等级刻度错误**：分箱是 0~9 但按 `/10` 展示，进度条永远到不了头。改 `/9`。
- **[Low] 起草接口 URL 留空无 fallback**：`DRAFT_PROVIDERS` 加官方 base URL，留空按 provider 兜底。

### Jev 内核 bug 修复（实测安装版时发现）

- **`norm()` 抹中文**：原用 `/[\s\W_]+/g`——JS 的 `\W` 不带 `u` flag 是 ASCII-only，中文被
  当非词字符全部抹掉，候选 norm 后变空串被整条丢弃，最终「没有拿到候选回复」。
  改 `/[\s\p{P}\p{S}_]+/gu`。（`draft.ts`）
- **危险等级渲染成 `[object Object]`**：`answers.danger_level.legend` 是对象被直接插值。
  换成本地 `dangerTierOf()` 档位查找。（`JevResultModal.tsx`）
- **Jev 开关不可见不可点**：`<span className="slider" />` 与 SCSS 的 `.switch-slider` 类名
  不匹配，滑块零尺寸不渲染。两处改类名（`SettingsPage.tsx`）。

### 测试

- Jev 内核单测 73 项（`npm run test:jev`），含 `sanitize` 的 Unicode 回归、`redactKey`
  脱敏回归、state 构造对照、engine 编排（桩替网络）。
- 两个 tsconfig 类型检查全绿。
- 消融实验：30 用例 × 12 变体，390 次调用，基线 81.9% 总体准确率，三项验收门槛全部通过
  （危险等级 MAE 0.50 < 1.0；真实意图 83.3% ≥ 60%；对方需要 80.0% ≥ 60%）。
  主要结论：对话历史是最重要的组件（去掉后 -10.5pp，MAE 升到 1.07 翻车）；7 道题之间无交叉依赖。

### 构建 / 工程化

- `package.json` 加三组 Jev 测试脚本（`test:jev` / `test:jev:e2e` / `test:jev:ablation`），
  esbuild bundle + electron stub 的方式跑。
- `.gitignore` 挡掉漏到根目录的 `/main.js` 构建产物、`.ablation/`（含完整调用记录）、
  `.agy-staff/` 工作目录。

### 文档 (docs)

- 新建 `AGENTS.md`（AI 协作规范与硬约束）、`DESIGN.md`（界面设计规范）、
  `docs/PROJECT-SPEC.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、
  `docs/COMPONENT-GUIDELINES.md`、`CHANGELOG.md`、`TODO.md`。
- README 充实技术栈与目录说明。

---

## 5.0.0 及以前

继承自原仓库 [hicccc77/WeFlow](https://github.com/hicccc77/WeFlow) 的最后一次 commit。
本仓库 fork 后的变更从 5.0.1 开始记录。
