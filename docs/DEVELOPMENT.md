# WeFlow 开发流程（DEVELOPMENT）

## 1. 环境准备

```bash
git clone https://github.com/tszlznl/WeFlow.git
cd WeFlow
npm install
```

`postinstall` 会做两件事，**不要跳过**：

1. `electron-builder install-app-deps` — 按当前 Electron 版本编译原生依赖。
2. `node scripts/prepare-electron-runtime.cjs` — Windows 下把 `resources/runtime/win32/` 的
   VC 运行时 DLL（`msvcp140.dll`、`msvcp140_1.dll`、`vcruntime140.dll`、`vcruntime140_1.dll`）
   同步到 `node_modules/electron/dist/`。原生模块依赖这些运行库，不同步会加载失败。

要求：Node 18+，Windows / macOS / Linux 任一。原生模块（koffi、sherpa-onnx、silk-wasm、
ffmpeg-static）随平台不同，**换平台开发要重新 `npm install`**。

## 2. 开发模式

```bash
npm run dev          # 标准开发（先跑 prepare-electron-runtime，再 vite）
npm run electron:dev # 同上，mode=electron
```

Vite 用 `vite-plugin-electron` 同时构建主进程和渲染层，热更新只对渲染层生效。**改主进程代码
（`electron/`）需要重启 dev**，改渲染层（`src/`）会热替换。

## 3. 类型检查与测试

```bash
npm run typecheck      # tsc --noEmit（根 tsconfig，渲染层）
npx tsc --project tsconfig.node.json --noEmit   # 主进程
```

**有两个 tsconfig，两个都要查**：根 `tsconfig.json` 覆盖渲染层，`tsconfig.node.json` 覆盖主进程。
曾经出现过类型错只在 node 那个 tsconfig 里暴露（`reply_to` 赋 `null` 但声明是 `string`），
根 tsconfig 查不出来。**改完主进程代码务必跑 node 那个。**

注意：`tsconfig.node.json` 目前对全项目检查，会报出一批**既有的、非本次引入的**类型错
（`bizService.ts`、`chatService.ts`、`exportWorker.ts` 等）。用 `grep -E "jev"` 之类筛自己
的文件即可，不用修别人的。

### Jev 内核测试

```bash
npm run test:jev          # 单测，纯逻辑，不联网（当前 73 项）
npm run test:jev:packs    # Phase 0：decide 原语 + 题集注册表 + 决策缓存（24 项，不联网）
npm run test:jev:e2e      # 端到端，会真实调 API（需要 key）
npm run test:jev:ablation # 消融实验，30 用例 × 12 变体（很贵，按需）
npm run test:jev:bg-probe # 探针：端点是否读 state.background（需要 JEV_JUDGE_KEY）
```

三者的机制相同：用 esbuild 把测试文件 bundle 成 CJS（`--alias:electron=…/electron-stub.js`
桩掉 electron 依赖），输出到 `node_modules/.cache/`，再 `node` 执行。

- **`test:jev` / `test:jev:packs` 不需要任何 key，随便跑。**
- **`test:jev:e2e` / `test:jev:ablation` / `test:jev:bg-probe` 需要 `JEV_JUDGE_KEY` 环境变量**，
  key 只进环境、不落文件。
- `test:jev:bg-probe` 是**一次性探针**：判断 decisions 端点是否真的读 `state.background`
  字段（详见 `docs/ARCHITECTURE.md` 的 Jev 章节）。在背景注入接上数据之前必须跑一次，
  结论写进 `TODO.md`。
- 消融实验产物默认写 `.ablation/`（含完整调用记录，已 gitignore，不进仓库）。

## 4. 打包发布

```bash
npm run build          # clean-dist-electron.cjs && tsc && vite build && electron-builder
npm run electron:build  # 同上（别名）
```

构建步骤：

1. `scripts/clean-dist-electron.cjs` — 删 `dist-electron/`。**必须清**：vite 产物带内容 hash
   （如 `config-DCE0JWFu.js`），不清会让旧 chunk 堆积并被误打进安装包。
2. `tsc` — 编译主进程到 `dist-electron/`。
3. `vite build` — 渲染层到 `dist/`，主进程与 7 个 worker 由 `vite-plugin-electron` 各自
   打包成独立 entry（`main.js`、`wcdbWorker.js` 等）。
4. `electron-builder` — 产出到 `release/`。

### electron-builder 配置要点

- `appId: com.WeFlow.app`，版本来自 `package.json`（当前 5.0.1）
- Windows target：`nsis`，产物 `WeFlow-<version>-Setup.exe`
  - `oneClick: false`、`allowToChangeInstallationDirectory: true`、`perMachine: false`
  - 自定义脚本 `installer.nsh`，语言 zh_CN + en_US
  - `extraFiles` 打入 4 个 VC 运行时 DLL 到应用根；`extraResources` 打 wcdb/wedecrypt/key 的
    win32 二进制
- macOS target：`dmg` + `zip`；`afterPack: scripts/after-pack.cjs` 用 otool + install_name_tool
  改写动态库依赖路径
- Linux target：`appimage` + `tar.gz`
- `asarUnpack`：`silk-wasm`、`sherpa-onnx-*`、`ffmpeg-static`、`electron-liquid-glass`、
  `resources/wedecrypt/**/*.node`（原生模块需落到磁盘）
- 自动更新：GitHub provider（发布配置在 `package.json` 的 `build.publish`）

### 静默安装（Windows）

```bash
release/WeFlow-5.0.1-Setup.exe /S
```

**安装前必须先关掉运行中的 WeFlow**（NSIS 不会自动处理）：

```bash
taskkill //IM WeFlow.exe //F
release/WeFlow-5.0.1-Setup.exe /S
```

装完后用 `%LOCALAPPDATA%/Programs/WeFlow/` 下的时间戳确认确实更新了。

### 验证产物

安装包里验证修复是否真的进去（不用启动应用也能查）：

```bash
# asar 里查渲染层字符串（注意：中文串用 latin1 转换会失配，查中文要去 dist/ 或解包 asar）
node -e "const s=require('fs').readFileSync('release/win-unpacked/resources/app.asar','latin1'); console.log(s.includes('switch-slider'))"

# 主进程 bundle 查正则/常量
grep -o '.\{60\}p{P}.\{30\}' dist-electron/main.js

# 编译后 CSS 查样式规则
grep -o 'switch-slider[^}]*}' dist/assets/*.css
```

## 5. 常见排障

| 症状 | 原因 | 处理 |
|---|---|---|
| 启动白屏 / 原生模块加载失败 | VC 运行时没同步 | 重跑 `node scripts/prepare-electron-runtime.cjs` |
| `require is not defined in ES module scope` | 脚本写成 .mjs 但用了 require | 用 `node --input-type=module` + `import` |
| tssc 报错但渲染层没事 | 只查了根 tsconfig | 补查 `tsconfig.node.json` |
| 打包后安装包体积异常大 | `dist-electron/` 没清 | 跑 `npm run build`（会先 clean），别只跑 electron-builder |
| 数据库连接失败 / 密钥获取失败 | 微信版本不兼容或进程被占 | 先完全退出微信再试；macOS 见 `docs/MAC-KEY-FAQ.md` |
| 配置文件膨胀导致卡顿 | 大缓存键写进了主配置 | 新缓存键走 `CacheMapStore` |

## 6. 提交与推送

```bash
# 推送前必做的回归
npm run typecheck
npx tsc --project tsconfig.node.json --noEmit
npm run test:jev

# 密钥扫描（只允许明显的假串命中，如 sk-or-v1-abcdefghij）
git diff --cached | grep -E 'sk-or-v1-[a-zA-Z0-9]{10,}|apikey_[a-zA-Z0-9]{10,}'

git add -A
git commit -m "..."
git push origin main
```

提交信息用中文，正文写清「做了什么 + 为什么」。目前直接推 main，没有 PR 流程，
**推送前的回归自己跑一遍**。

## 7. 相关文档

- `docs/ARCHITECTURE.md` — 架构与目录结构
- `docs/PROJECT-SPEC.md` — 定位与功能范围
- `docs/COMPONENT-GUIDELINES.md` — 渲染层组件规范
- `docs/HTTP-API.md` — 本地 HTTP API
- `docs/MAC-KEY-FAQ.md` — macOS 密钥提取排障
- `AGENTS.md` — AI 协作规范与硬约束
