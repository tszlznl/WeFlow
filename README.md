
### 本仓库只是暂时为个人使用，取自[原仓库](https://github.com/hicccc77/WeFlow)的最后一次commit版本，如若造成任何侵权，请联系删库。

## WeFlow 是什么

本地优先的微信聊天数据桌面工具：读取本机微信 4.x 的数据库与媒体文件，提供会话浏览、全局搜索、
数据分析、年度报告、导出留存、AI 见解，以及一个对话副驾 **Jev 助手**。

**它是本地工具，不是云服务**：数据不离开本机（用户自行配置的 AI API 调用和可选的推送 webhook
除外）。不自动发送任何消息，不碰转账/红包/收款。

## 技术栈

| 层 | 技术 |
|---|---|
| 壳 | Electron 43（多窗口，hash 路由区分窗口） |
| 渲染层 | React 19 + TypeScript + Vite，zustand，react-router 7 |
| 主进程 | Node + worker_threads（数据库操作全在 worker 线程） |
| 数据库 | koffi（FFI）调原生 WCDB 的 C 接口，免编译原生 addon |
| 打包 | electron-builder（Windows NSIS / macOS dmg+zip / Linux appimage） |

## 从源码构建

```bash
# 1. 克隆项目到本地
git clone https://github.com/tszlznl/WeFlow.git
cd WeFlow

# 2. 安装项目依赖（postinstall 会装原生依赖 + 同步 VC 运行时）
npm install

# 3. 运行应用（开发模式）
npm run dev

# 类型检查（两个 tsconfig 都要查）
npm run typecheck
npx tsc --project tsconfig.node.json --noEmit

# Jev 内核单测（不联网，不需要 key）
npm run test:jev

# 打包安装包到 release/
npm run electron:build
```

Windows 静默安装：先 `taskkill //IM WeFlow.exe //F` 退出旧版，再
`release/WeFlow-<version>-Setup.exe /S`。

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | AI 协作规范与硬约束（接力开发前必读） |
| [DESIGN.md](DESIGN.md) | 界面设计规范：主题系统、设计令牌、字号间距、复用组件类 |
| [docs/PROJECT-SPEC.md](docs/PROJECT-SPEC.md) | 项目定位、技术选型、功能范围 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构分层、目录结构、核心数据通路、Jev 链路 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发、构建、测试、打包、排障 |
| [docs/COMPONENT-GUIDELINES.md](docs/COMPONENT-GUIDELINES.md) | 渲染层组件、样式、状态管理规范 |
| [docs/HTTP-API.md](docs/HTTP-API.md) | 本地 HTTP API（127.0.0.1:5031，Token 鉴权，SSE 推送） |
| [docs/MAC-KEY-FAQ.md](docs/MAC-KEY-FAQ.md) | macOS 微信密钥提取失败排障 |
| [CHANGELOG.md](CHANGELOG.md) | 版本更新记录 |
| [TODO.md](TODO.md) | 开发计划与当前进度 |

## 致谢

- [密语 CipherTalk](https://github.com/ILoveBingLu/miyu) 为本项目提供了基础框架
- [WeChat-Channels-Video-File-Decryption](https://github.com/Evil0ctal/WeChat-Channels-Video-File-Decryption) 提供了视频解密相关的技术参考

### 合作伙伴

<p align="center">
  <!-- 是的你没看错这里还是占位！
  <a href="https://your-partner-website.com" target="_blank">
    <img src="https://via.placeholder.com/150x50?text=Partner+1+Logo" alt="Partner Name" width="150" style="margin: 10px; vertical-align: middle;" />
  </a> -->
</p>

---

## 贡献者

悼念所有做出贡献的开发者！

<p align="center">
  <a href="https://github.com/hicccc77/WeFlow/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=hicccc77/WeFlow" alt="Contributors" />
  </a>
</p>
