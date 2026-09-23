# AGENTS.md — 与 AI 协作开发 WeFlow 的规范

这份文件是给所有会话（ZCode / Codex / Cursor / Claude 等）看的。接力开发前先读完本文件和
`docs/ARCHITECTURE.md`，避免重复踩坑或破坏既有约定。

## 1. 项目是什么

WeFlow 是一个 Electron 桌面应用（React 19 + TypeScript + Vite），读取本机微信 4.x 的聊天数据，
提供会话浏览、消息搜索、数据分析、年报、导出、AI 见解等功能。**它是本地工具，不是网站**：
没有后端服务器、没有 Cloudflare 部署、没有组件注册表。任何让你「部署到云」「发布组件」的需求，
先停下来确认是不是搞错了项目。

仓库是 fork（原仓库 hicccc77/WeFlow），当前推送到 tszlznl/WeFlow 的 main 分支。

## 2. 硬约束（违反即返工）

这些约束来自源项目和用户要求，**任何会话都必须遵守**：

- **不 hook 微信进程、不注入、不碰微信进程内存做恶意操作。** 密钥提取（`keyService*.ts`）是
  读取自己电脑上自己有权查看的数据所必需的，且只在用户主动触发时进行；不要扩展它的用途。
- **不自动发送消息。** Jev 助手生成的候选回复只进剪贴板供用户自己粘贴，**绝不发回车、绝不
  模拟点发送、绝不调任何发信接口**。看到「自动回复」类的需求一律拒绝。
- **不碰钱。** 转账、红包、收款相关的一律不读、不导出、不分析。
- **API key 不落盘、不进日志、不进 git。**
  - key 只能从环境变量或 App 加密设置项（`safeStorage`）读。
  - 报错文本必须脱敏：`electron/services/jev/jevClient.ts` 的 `redactKey` 是统一出口，
    带 `sk-`/`apikey_` 格式正则兜底——**写新网络代码时复用它，不要自己 stringify error**。
  - 任何文件、日志、提交里都不许出现 `sk-or-`、`apikey_` 开头的明文串。测试 fixture 用
    `sk-or-v1-abcdefghij`、`apikey_0000...` 这种明显的假串。
  - `ENCRYPTED_STRING_KEYS` 里的配置项由 ConfigService 自动加解密，不要绕过它直接读 store。

## 3. Python → JS 移植陷阱

Jev 判断核心从 Python 移植而来，这类语义偏移已经踩过一次大的：

- **正则的 `\W`：** Python 的 `re` 默认 Unicode 感知（中文是词字符）；JS 的 `\W` 不带 `u` flag
  是 ASCII-only，**中文会被当成非词字符全部抹掉**。需要「非词字符」语义时用
  `/[\s\p{P}\p{S}_]+/gu`，不要用 `\W`。见 `electron/services/jev/draft.ts` 的 `norm()` 注释。
- **任何从 Python 搬过来的正则、排序、边界比较，都要对一遍 Python 原版行为**，不能只看
  「能跑起来」。移植代码的测试用例应当逐条来自 Python 原版的 `__main__` 自测。

## 4. 目录约定

```
electron/          主进程（Node 侧）
  main.ts          入口 + 全部 ipcMain.handle（~210 个 channel）
  preload.ts       contextBridge，渲染层唯一入口 window.electronAPI
  services/        业务服务（config / chatService / jevService / export/ ...）
  *Worker.ts       worker_threads 入口（wcdb 数据库操作全在 wcdbWorker 线程）
src/               渲染层（React）
  pages/           页面；components/、stores/（zustand）、services/ipc.ts
docs/              本文件所在目录
resources/         随包分发的原生二进制（wcdb / wedecrypt / key / 运行时）
scripts/           构建脚本（prepare-electron-runtime / clean-dist-electron / after-pack）
```

核心数据通路（最重要的链路，任何改动先评估这条）：

```
wcdbCore(Worker 线程内，koffi 调原生 C 接口)
  → wcdbService(主进程代理，请求/响应配对)
    → chatService(领域服务)
      → main.ts(IPC)
        → preload.ts
          → 渲染层
```

## 5. 开发流程

```bash
npm install          # postinstall 会装原生依赖 + 同步 VC 运行时
npm run dev          # 开发模式
npm run typecheck    # tsc --noEmit
npm run test:jev     # Jev 内核单测（当前 73 项）
npm run electron:build   # 打包安装包到 release/
```

- **改完任何主进程或渲染层代码，跑 `npm run typecheck`。** 注意有两个 tsconfig：根 `tsconfig.json`
  查渲染层，`tsconfig.node.json` 查主进程。两个都要过——曾经有类型错只在 node 那个里暴露。
- **Jev 相关改动跑 `npm run test:jev`**，纯逻辑测试不联网。
- **不要提交构建产物**：`dist/`、`dist-electron/`、`release/` 已忽略；`/main.js` 是 electron-builder
  漏到根的 bundle，也忽略了；`.ablation/`（消融实验产物，含完整调用记录）不进仓库。

详见 `docs/DEVELOPMENT.md`。

## 6. 提交与推送

- 提交信息用中文，写清「做了什么 + 为什么」，多行正文列要点。
- 推送前扫一遍密钥：`git diff --cached | grep -E 'sk-or-v1-[a-zA-Z0-9]{10,}|apikey_[a-zA-Z0-9]{10,}'`，
  只允许明显的假串命中。
- 目前直接推 main。没有 PR 流程，所以**每次推送前自己把回归跑一遍**（typecheck + 相关测试）。

## 7. 已知的历史包袱（不要意外扩大）

- `electron/main.ts` 单文件聚合了全部 IPC 注册，非常大；`chatService.ts` 同样巨大。新功能
  **优先落进 `services/` 的独立文件**，不要继续往这两个文件里塞。
- 渲染层多窗口共用同一个 `dist/index.html`，靠 hash 路由区分（`/chat-window`、`/video-player-window` 等）。
  加新窗口要在 `main.ts` 建窗口处和 `App.tsx` 路由两侧同步。
- 大体积 UI 缓存键走独立的 `CacheMapStore`（`cacheMapStore.ts`）而不是主配置——历史上这些键
  把配置文件撑到 3.2MB 导致主线程阻塞。新的缓存键也走这条路。

## 8. 会话交接

- 接力上一个会话时，先读 `docs/ARCHITECTURE.md` 和 `CHANGELOG.md`，再动手。
- 留下工作时：未完成的事项写进 `TODO.md` 并标明状态；做了实验（消融、对照）的结论写进
  `CHANGELOG.md` 或对应文档，不要只留在会话里。
- 改了用户可见的行为，`CHANGELOG.md` 要记一笔。
