# 更新记录（CHANGELOG）

格式：版本 + 日期，按功能域分组；`(docs)` 标文档变更。逆序排列，最新在上。

---

## Phase 4：日记 — 2026-09-26（未发版，main 分支）

对一整天的对话跑一次判断，拼一段**只读**每日总结进 InsightInbox。Jev 只有 Noul/Choice、
写不出散文，所以日记是「结论拼装」而非生成：氛围（choice）+ 有没有值得记住的瞬间（noul）
+ 事情收尾了没（noul），加上前端自己能算的消息条数。
**210 项测试全过**（73 + 24 + 15 + 21 + 29 + 48）。

### 新增

- **`diary` 题集**（`jev/diaryQuestions.ts`）— 三道题：`diary_mood`（choice 五类氛围：
  轻松愉快/平淡日常/小有摩擦/明显冲突/冷战疏远）、`diary_highlight`（有没有值得记住的瞬间
  或重要决定）、`diary_unresolved`（结束时还有没有没收尾的事，呼应待办）。
  **日记故意不吃 5 小时时间窗**——日记要覆盖从早到晚，吃了窗口早上的消息就没了。
- **`shapeDiary()`**（`jevService.ts`，导出）— 答案整形为 `JevDiary`。整体把握取三道题里
  选中结论把握的最低值（最保守）。**答案缺失时按「没有」处理**：没判出来就不能说这天
  有值得记住的瞬间（缺失时把握显示 50%）。
- **`jevService.summarizeDay()`** — 缓存键 `diary:${dayEnd}`，`ttlMs=0` 永不过期（有效性由
  「同一天」语义保证）；state 喂一整天气泡；同一天（同 `dayEnd`）的旧记录按 id 删掉再建，
  不清整个会话——不然生成今天的会把昨天的删掉。`InsightRecordSourceType` 加 `jev_diary`。
- **`insightRecordService.deleteRecord(id)`** — `clearRecords` 只按 sessionId + 时间段筛，
  没法按「总结到哪天」去重，所以补一个按 id 删。
- **IPC `jev:summarizeDay`** + preload + 类型；InsightInbox 加「Jev 日记」筛选 tab + 卡片
  渲染（氛围标签 / 氛围把握 / 已收尾或有未处理完的事）。日记卡片不带消息反链（没有有效
  localId），点卡片只进会话不定位消息。
- 前端：会话详情面板「生成今日小结」按钮（ChatPage），`DIARY_MOOD_LABELS` 进共享 `jevLabels.ts`。
- `npm run test:jev:phase4` — 48 项：题集结构 / shapeDiary 边界（含残缺答案） /
  summarizeDay 入库内容 / 同天去重 / 不同天并存 / 缓存命中 / 无 key 拒绝 / 死端点不写
  半成品 / 时间窗不吃。本地 mock 服务器，全程不联网。

---

## Phase 3：待办提取 — 2026-09-26（未发版，main 分支）

从对话里捞出「要我去做的事」，轻量版不建独立 UI，直接塞进 InsightInbox（带消息反链）。
**162 项测试全过**（73 + 24 + 15 + 21 + 29）。

### 新增

- **`todo` 题集**（`jev/todoQuestions.ts`）— 三道题：`todo_present`（闸门 noul：这条消息
  有没有要我做的明确请求或承诺，<0.5 整条跳过）、`todo_when`（有没有明确截止）、
  `todo_kind`（六类：约见/工作交办/承诺跟进/提醒/求助/其他）。Jev 没有生成题，待办文本
  就是源消息本身，判断只负责分类和定性。
- **`jevService.scanTodos()`** — 复用 annotate 的定位/批量管线（抽出 `loadMessages` /
  `locateTargets` / `runDecideBatch` 三个私有方法）。闸门达标且未入库的写进
  `insightRecordService`，`sourceType: 'jev_todo'`，`messageInsight` 带目标消息键/localId/
  时间，点击卡片复用深度解析的反链跳转。同会话同消息不重复建；`forceRefresh` 先清后建。
- **5 小时时间窗** — 与最新消息间隔超过 5 小时的消息不喂给判断（上一轮吵架、上次的话题会
  带偏意图）。上下文既有条数上限（`cfg.context`）又有时长上限。注意 createTime 是 Unix
  **秒**，时间窗常量也是秒。
- **IPC `jev:scanTodos`** + preload + 类型；`InsightRecordSourceType` 加 `jev_todo`，
  InsightInbox 加「Jev 待办」筛选 tab + 卡片渲染（类型/截止/把握 + 源消息反链）。
- 前端：会话详情面板「提取待办」按钮（ChatPage），`TODO_KIND_LABELS` 进共享 `jevLabels.ts`。
- `npm run test:jev:phase3` — 29 项：题集结构 / 闸门 / 入库内容 / 去重 / forceRefresh /
  5 小时时间窗 / 死端点不留半成品。judge 端点指向本地 mock 服务器（按请求最后一条消息回
  固定答案并记录 state），全程不联网。

---

## Phase 2：聊天信息标注 — 2026-09-26（未发版，main 分支）

按需扫一屏对方消息，给每条标「话里有话 / 字面意思 + 真实意图 + 对方需要」，徽标挂气泡上。
判断的是结构化结论，和已有的 `MessageInsightControl`（生成式解析）是两路数据。
**133 项测试全过**（73 + 24 + 15 + 21）。

### 新增

- **`annotate` 题集**（`jev/packs.ts`）— 只收 `literal_question` + `true_intent` +
  `she_needs` 三道轻题；故意不收 `danger_level`（贵，徽标场景用不上）。
- **`jevService.annotateSession()`** — 前端指定 targets（自带 messageKey），后端在消息流里
  按 `createTime + 文本前 40 字` 双匹配定位（只靠时间戳会撞车）。每条用目标之前的消息当
  上下文、目标本身是最后一条。3 路分批并发（顺序跑 10 条 ~20 秒，并发 ~7 秒，又不撞
  rate limit），失败条目下次扫描自动重试（命中的已进缓存）。上限 15 条/次。
- **共享 `shapeAnnotation()`** — answers → 徽标；`literal_question` 的命题是「纯字面」，
  <0.5 才是有潜台词，否定态把握 = 1-v（和 `shapeQuickVerdict` 一个口径）。
- **IPC `jev:annotateSession`** + preload + `JevAnnotation` 类型。
- 前端：会话详情面板加「标注本页消息」按钮（带进度/结果提示）；气泡正文下挂徽标
  （`JevAnnotationBadges`，话里有话用强调色提一下）；切会话清徽标（缓存在主进程，二次
  扫描命中不花钱）；`jevAnnotations` 进 `renderMessageListItem` 依赖和气泡 memo 比较。
- `npm run test:jev:phase2` — 21 项：题集结构 / shapeAnnotation 边界 / 缓存键隔离 /
  annotateSession 真实单例（judge 端点指向 127.0.0.1:1，连接被拒立刻失败不重试，全程不联网）。

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
