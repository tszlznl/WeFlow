# WeFlow 架构文档

## 1. 总体分层

WeFlow 是标准的三段式 Electron 应用，所有数据操作都在本地完成：

```
┌─────────────────────────────────────────────────────────────┐
│ 渲染层（React 19 + Vite，src/）                              │
│   pages/ ─ components/ ─ stores/(zustand) ─ services/ipc.ts  │
└───────────────────────────┬─────────────────────────────────┘
                            │  contextBridge: window.electronAPI
┌───────────────────────────┴─────────────────────────────────┐
│ 主进程（electron/）                                          │
│   main.ts（IPC 注册）─ services/（领域服务）─ *Worker.ts      │
└───────────────────────────┬─────────────────────────────────┘
                            │  koffi FFI
┌───────────────────────────┴─────────────────────────────────┐
│ 原生层（resources/）                                         │
│   wcdb/（WCDB 数据服务）wedecrypt/ key/ runtime/             │
└─────────────────────────────────────────────────────────────┘
```

**渲染层与主进程之间只有一个通道**：`electron/preload.ts` 用 `contextBridge.exposeInMainWorld`
暴露的 `window.electronAPI`。没有 `ipcRenderer` 直接暴露给渲染层，新功能也必须走这条桥。

## 2. 核心数据通路

这是全项目最重要的一条链，任何涉及聊天数据的改动都要先评估它：

```
wcdbCore          worker_threads 线程内，koffi 加载原生库，
  (wcdbWorker.ts) 声明全部 C 函数，执行 SQL 并返回 JSON 字符串
       ▲
wcdbService       主进程里的纯代理。initWorker() 起线程，
                   用 pending Map<id,{resolve,reject}> 匹配请求/响应；
                   worker 发来的 type:'monitor' 消息转发给监听者
       ▲
chatService       领域服务（会话/消息/联系人/统计/头像），
                   通过 wcdbService.setMonitor 注册 DB 变更回调
       ▲
main.ts           ipcMain.handle 注册（约 210 个 channel）
       ▲
preload.ts        contextBridge
       ▲
渲染层            chatStore / ipc.ts
```

**为什么数据库操作要放 worker**：WCDB 的同步调用会阻塞，放在主进程会导致窗口卡死。所有 DB
调用都经 worker 线程，主进程只做代理转发。数据库变更监听底层用 `ReadDirectoryChangesW`
（Windows），变更事件以 `wcdb-change` 广播给所有渲染窗口。

## 3. 目录结构

```
electron/                     主进程
  main.ts                     入口 + app 生命周期 + 全部 ipcMain.handle + 托盘/菜单/自动更新
  preload.ts                  contextBridge，渲染层唯一入口
  preload-env.ts              向渲染层注入的环境变量封装
  services/                   全部业务服务（见下节）
  windows/                    通知窗口（Windows 走 electron-liquid-glass 原生玻璃面板）
  utils/                      LRUCache、pathUtils（expandHomePath）
  types/                      第三方原生模块声明（sherpa-onnx-node、whisper-node）
  assets/wasm/                WASM 资源（打包进 resources/assets/wasm/）
  *Worker.ts                  worker 入口：wcdb / export / annualReport / dualReport /
                              imageDecrypt / imageSearch / transcribe / apiMessage
src/                          渲染层
  App.tsx                     路由 + Sidebar + RouteGuard；Settings 以覆盖层挂载
  pages/                      页面（见下节）
  components/                 通用控件与业务组件
  stores/                     9 个 zustand store
  services/                   ipc.ts（对 electronAPI 的封装）等
  styles/                     全局样式与主题
scripts/                      构建/发布脚本
  prepare-electron-runtime.cjs  Windows：把 VC 运行时 DLL 同步到 electron/dist
  clean-dist-electron.cjs       构建前清 dist-electron（否则旧 hash chunk 堆进安装包）
  after-pack.cjs                macOS：otool+install_name_tool 改写动态库依赖
resources/                    随包分发的原生二进制（wcdb/wedecrypt/key/运行时/图标）
shared/                       跨进程共享静态数据（groupSummaryPrompt.json）
public/                       Vite 静态资源根（图标、splash、表情贴纸素材）
docs/                         本目录
release/                      electron-builder 产物（已 gitignore）
```

### `electron/services/` 服务清单

按职责聚类（文件名即清单）：

- **数据访问**：`wcdbCore.ts`（koffi 调 C 接口，worker 内运行）、`wcdbService.ts`（主进程代理）、
  `chatService.ts`（聊天领域门面）、`dbPathService.ts`、`accountDirResolver.ts`、
  `keyService.ts` / `keyServiceMac.ts` / `keyServiceLinux.ts`（密钥提取）、`isaac64.ts`
- **媒体解密**：`imageDecryptService.ts`、`nativeImageDecrypt.ts`、`imagePreloadService.ts`、
  `imageDownloadService.ts`、`videoService.ts`、`voiceTranscribeService.ts`、`wasmService.ts`
- **配置/缓存**：`config.ts`、`cacheMapStore.ts`、`messageCacheService.ts`、
  `contactCacheService.ts`、`sessionStatsCacheService.ts`、`groupMyMessageCountCacheService.ts`、
  `avatarFileCacheService.ts`、`exportContentStatsCacheService.ts`
- **分析/报告**：`analyticsService.ts`、`groupAnalyticsService.ts`、`annualReportService.ts`、
  `dualReportService.ts`、`bizService.ts`、`snsService.ts`
- **导出**：`export/`（`ExportServiceFacade` 统一出口，内含 core/stats/parsers/formatters/media/
  contacts/utils 子模块）、`exportTaskControlService.ts`、`exportRecordService.ts`、
  `exportCardDiagnosticsService.ts`、`contactExportService.ts`
- **AI**：`insightService.ts`、`insightProfileService.ts`、`insightRecordService.ts`、
  `jevService.ts` + `jev/`（见第 5 节）、`groupSummaryService.ts` / `groupSummaryRecordService.ts`
- **推送/通知/网络**：`messagePushService.ts`、`httpService.ts`（本地 HTTP API 服务端）、
  `systemNotificationService.ts`、`cloudControlService.ts`、`weliveBridge.ts`
- **其他**：`backupService.ts`、`windowsHelloService.ts`、`social/weiboService.ts`、
  `apiMessageMapping.ts` / `apiMessageMapperPool.ts`

### 渲染层页面

`src/pages/`：`HomePage`、`WelcomePage`、`AccountManagementPage`、`AgreementPage`、`ChatPage`
（子目录 `Chat/`）、`ChatHistoryPage`、`ChatAnalyticsHubPage`、`AnalyticsWelcomePage`、
`AnalyticsPage`、`GroupAnalyticsPage`、`AnnualReportPage` / `AnnualReportWindow`、
`DualReportPage` / `DualReportWindow`、`MyFootprintPage`、`SnsPage`、`InsightInboxPage`、
`BizPage`、`ContactsPage`、`ResourcesPage`、`BackupPage`、`SettingsPage`、`ImageWindow`、
`VideoWindow`、`NotificationWindow`、导出模块目录 `Export/`。

**多窗口共用同一个 `dist/index.html`**，靠 hash 路由区分：主进程以
`hash: '/chat-window?...'`、`/video-player-window?…`、`/image-viewer-window?…`、
`/agreement-window` 等加载各窗口。**加新窗口要同时改 `main.ts` 建窗口处和 `App.tsx` 路由。**

### 状态管理

`src/stores/`（zustand，共 9 个）：`appStore`、`chatStore`、`analyticsStore`、
`contactTypeCountsStore`、`imageStore`、`exportTaskStore`、`batchTranscribeStore`、
`batchImageDecryptStore`、`themeStore`（主题：cloud-dancer / corundum-blue / kiwi-green /
spicy-red / teal-water / blossom-dream / geist）。

## 4. IPC 层

`electron/main.ts` 注册约 210 个 `ipcMain.handle` channel，命名统一为 `<域>:<动作>`：
`analytics`、`annualReport`、`app`、`auth`、`backup`、`cache`、`chat`（约 45 个）、`cloud`、
`config`、`dbpath`、`diagnostics`、`dialog`、`dualReport`、`export`、`groupAnalytics`、
`groupSummary`、`http`、`image`、`insight`、`jev`、`key`、`log`、`shell`、`sns`（约 18 个）、
`social`、`video`、`wcdb`、`whisper`、`window`（约 15 个）。

另有单向 channel：
- 渲染 → 主（`ipcRenderer.send`）：`notification-clicked`、`notification:ready`、
  `notification:resize`、`notification:glassRect`、`notification:glassHide`、`log:debug`、
  `window:minimize` 等。
- 主 → 渲染（推送）：`wcdb-change`、`notification:luma`、`notification:show`、
  `navigate-to-session`、`navigate-to-route`、`app:downloadProgress`、`app:updateAvailable`。

preload 暴露的顶层命名空间（`window.electronAPI.*`，34 个）：`config`、`notification`、`auth`、
`dialog`、`shell`、`app`、`log`、`diagnostics`、`window`、`dbPath`、`wcdb`、`backup`、`key`、
`chat`、`image`、`video`、`process`、`analytics`、`cache`、`groupAnalytics`、`annualReport`、
`dualReport`、`export`、`whisper`、`sns`、`biz`、`cloud`、`http`、`insight`、`groupSummary`、
`social`、`jev`，加上散布在各命名空间内的 `onXxx` 回调监听器。

## 5. Jev 判断助手链路

本仓库新增的独立链路，内核对 WeFlow 零依赖，可单独测试：

```
ChatPage 右键对方消息 / 聊天页头部「分析当前会话」
  → IPC jev:analyzeSession（jevService.analyzeSession）
    → chatService.getMessages 取最近 N 条
      → adapter.messagesToBubbles 适配成 {from:'her'|'me', text, name?}
        → engine.analyze
            ├─ draft.draftCandidates  盲起草 3 条（chat/completions，OpenAI 兼容）
            │     └─ sanitize：去重 / 鹦鹉学舌过滤 / 注入防护（norm 用 \p{P}\p{S} 不用 \W）
            ├─ questions.buildState   构造判断用的 state（关系、消息、is_group、reply_to）
            ├─ questions.JUDGE_QUESTIONS + buildRankQuestion（7 道判断题 + 1 道排序题）
            └─ jevClient.ask          一次 decisions 调用拿回全部答案 + 各候选胜出概率
  → IPC 回渲染层 → JevResultModal 展示
```

**盲起草的关键**：`draft.draftCandidates` 的输入只有对话原文、关系设定、用户口吻样本，
**7 道题的判断结果不进起草 prompt**。排序在起草之后，由 Jev 的第 8 题（`best_reply`）完成。

**两个 provider**：TypeSafe 官方 `https://api.typesafe.ai/v1/systemone`（模型 `jev-latest`），
或 OpenRouter 中转 `https://openrouter.ai/api/v1/../decisions`（模型 `typesafe/jev-1.13`）。
由 `resolveJudgeEndpoint` 按 provider 或用户填的 endpoint 解析。

**密钥处理**：判断和起草的 key 都从 ConfigService 的加密配置项读，只在调用期间存在；
所有进日志/异常的文本过 `jevClient.redactKey`（显式 key 替换 + `sk-`/`apikey_` 格式正则兜底）。
**绝不自动发送**：候选回复只挂「复制到剪贴板」事件，全链路没有任何发信调用。

## 6. 配置体系

`electron/services/config.ts` 的 `ConfigService` 单例：

- **持久化**：electron-store v11，文件名 `WeFlow-config`。
- **加密**：Electron `safeStorage`，密文带 `safe:` 前缀。
  - `ENCRYPTED_STRING_KEYS`：`decryptKey`、`imageAesKey`、`authPassword`、`httpApiToken`、
    `aiModelApiKey`、`aiInsightApiKey`、`aiInsightWeiboCookie`、`jevJudgeApiKey`、`jevDraftApiKey`
  - `ENCRYPTED_BOOL_KEYS`：`authEnabled`、`authUseHello`（`false` 不写 keychain，避免无谓弹窗）
  - `ENCRYPTED_NUMBER_KEYS`：`imageXorKey`
- **锁定模式**：`authEnabled` 开启后，`decryptKey` / `imageAesKey` / `imageXorKey` 改用密码
  派生密钥加密（`lock:` 前缀）。`isLockMode()` 靠读取 `decryptKey` 前缀判断。
- **大缓存旁路**：以 `CacheMap` 结尾的大体积 UI 缓存键走独立的 `CacheMapStore`
  （`cacheMapStore.ts`），不进主配置——历史上这些键把配置文件撑到 3.2MB 导致主线程阻塞。
  **新的缓存键也走这条路。**
- **迁移**：`migrateCacheMapKeys()`、`migrateAuthFields()`、`migrateAiConfig()`。
- `getAccountDir(dbPath, wxid)` 也在此服务，配合 `accountDirResolver.ts` 定位账号目录。

## 7. 数据来源与只读边界

**连接链路**：`chatService.connectInternal()` → `configService.getAccountDir()` →
`wcdbService.open(accountDir, decryptKey)` → worker 内 `WcdbCore.initialize()` 用 koffi 加载
`resources/wcdb/<platform>/<arch>/` 下的原生库，`wcdb_open_account` 逐库打开并注入 hex 密钥。

**密钥提取**：`keyService.ts`（Windows，koffi 调 Win32 API 枚举进程/窗口取 key）、
`keyServiceMac.ts`、`keyServiceLinux.ts`。**仅在用户主动触发时进行。**

**媒体**：图片 `.dat` 用 `imageXorKey`（XOR）或 `imageAesKey`（原生 AES，
`tryDecryptDatWithNative`）解密；优先走 hardlink 解析而非改写原库。

**只读边界（重要，写文档/对外说明时要准确）**：应用**不是严格只读**。设计以读为主，但存在
有限的写接口：`chatService` 的 `updateMessage()` / `deleteMessage()` / `markAllSessionsRead()`、
撤回提醒用的触发器安装（`installAntiRevokeTriggers`）、`snsService` 的拉黑删除检测触发器。
**「绝不自动发送」「不碰钱」是 Jev 与整体的功能约束，不是数据库层面的只读声明。**

## 8. 已知的历史包袱

- `electron/main.ts` 单文件聚合了全部 IPC 注册，体积巨大；`chatService.ts` 同样巨大。
  **新功能优先落进 `services/` 的独立文件**，不要继续往这两个文件塞。
- 渲染层导出页用 keepalive 懒加载（`exportMounted` + 锚点 div），改导出页路由时注意这个机制。
- `vite.config.ts` 用 `vite-plugin-electron` 为 `main.ts` 和 7 个 worker 各自定义独立 entry。

## 相关文档

- `docs/PROJECT-SPEC.md` — 定位与功能范围
- `docs/DEVELOPMENT.md` — 开发、构建、测试流程
- `docs/HTTP-API.md` — 本地 HTTP API
- `AGENTS.md` — AI 协作规范与硬约束
