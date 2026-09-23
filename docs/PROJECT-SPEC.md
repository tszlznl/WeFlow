# WeFlow 项目规格（PROJECT-SPEC）

## 定位

WeFlow 是一个**本地优先的微信聊天数据桌面工具**：读取本机微信 4.x 的数据库与媒体文件，
提供浏览、检索、分析、导出和 AI 辅助能力。它解决的是「自己电脑上、自己本来就有权查看的
对话数据，想看、想找、想留存，但官方客户端不方便」这个问题。

**它不是：**

- 不是云服务。没有后端，数据不离开本机（除了用户自己配置的 AI API 调用和可选的推送 webhook）。
- 不是网站。没有 Cloudflare 部署、没有 SSR、没有组件注册表。
- 不是群发/营销/自动化运营工具。**不自动发送任何消息**。
- 不是取证或监控他人设备的工具。只处理用户自己有权访问的数据。

## 技术选型

| 层 | 技术 |
|---|---|
| 壳 | Electron 43，多窗口，hash 路由区分窗口 |
| 渲染层 | React 19 + TypeScript + Vite，zustand 状态管理，react-router 7 |
| 主进程 | Node，worker_threads 承载数据库操作 |
| 数据库 | 通过 koffi（FFI）调原生 WCDB 的 C 接口，免编译原生 addon |
| 原生能力 | koffi 调 Win32 API（密钥提取）、sherpa-onnx（语音转写）、silk-wasm（音频解码）、ffmpeg |
| 打包 | electron-builder（Windows NSIS / macOS dmg+zip / Linux appimage） |

## 功能范围

**核心（已实现）**

- 多账号管理：自动探测微信数据目录与 wxid，数据库密钥自动提取（Windows / macOS / Linux）。
- 会话与消息：游标分页加载、全局搜索、按日期跳转、撤销提醒（触发器方式）、媒体预览。
- 媒体：图片 `.dat` 解密（XOR / AES 原生两种路径）、视频、语音转写、朋友圈媒体。
- 分析：单聊/群聊统计、热力图、词云、年度报告、双人报告、「我的足迹」。
- 导出：会话/联系人/朋友圈导出（HTML 等格式），任务中心、后台批量、自动化任务。
- 朋友圈：时间线浏览、导出、拉黑删除检测。
- 本地 HTTP API：`127.0.0.1:5031`，Token 鉴权，SSE 主动推送（见 `docs/HTTP-API.md`）。
- AI 见解：沉默联系人扫描、AI 消息见解、群摘要。
- Jev 助手：对话副驾，判断「值不值得回」并起草候选回复（见下）。

**Jev 判断助手（本仓库的新增部分）**

从 Python 项目（jev-chat-jarvis / jev-chat-windows）移植的判断核心。它**不是生成式 LLM 的
封装**，而是调用 TypeSafe 的 decisions 接口做结构化判断：

- 两次调用分离的**盲起草架构**：起草（chat/completions）和判断（decisions）互相独立，
  判断结果不泄漏进起草 prompt，避免生成模型迎合判断。
- 7 道判断题（是否有潜台词 / 真实意图 / 危险等级 / 是否该现在回 / 建议做法 / 对方需要 /
  紧张是否已化解）+ 1 道排序题，一次 decisions 调用问完。
- 三种原语：Noul（0~1 的命题概率）、Choice（多选一）、Score（分箱打分）。
- 两个 provider：TypeSafe 官方 `api.typesafe.ai/v1/systemone`，或 OpenRouter 中转
  `openrouter.ai/api/alpha/decisions`。
- 输出 3 条候选回复 + 排序 + 各条胜出概率。**只读不写：候选进剪贴板，用户自己粘贴，绝不自动发送。**

**明确的边界（不做）**

- 不自动发送消息、不模拟回车/点击发送。
- 不碰转账、红包、收款。
- 不 hook 微信进程做注入（密钥提取除外，且仅用户主动触发）。
- 不把用户数据上传到任何第三方（AI API 调用除外，由用户自行配置 key）。

## 目标用户

需要管理本地微信数据的个人用户：备份聊天记录、查找旧消息、生成年度回忆、导出留存。
Jev 助手面向「想回复但不知道怎么回」的社交场景，提供判断依据和候选措辞。

## 相关文档

- `docs/ARCHITECTURE.md` — 架构与目录结构
- `docs/DEVELOPMENT.md` — 开发、构建、测试流程
- `docs/HTTP-API.md` — 本地 HTTP API
- `docs/MAC-KEY-FAQ.md` — macOS 密钥提取排障
- `AGENTS.md` — AI 协作规范与硬约束
