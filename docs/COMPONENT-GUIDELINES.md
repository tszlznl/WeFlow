# WeFlow 渲染层组件规范（COMPONENT-GUIDELINES）

本文是写 `src/` 下 React 组件的约定。不是组件库发布规范——WeFlow 不发布组件，这些规范
只用于保持现有代码的一致性。

## 1. 组件写法

**统一函数组件 + Hooks**，不写 class 组件：

```tsx
import React, { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import './Avatar.scss'

interface AvatarProps {
  src?: string
  size?: number
}

export function Avatar({ src, size = 32 }: AvatarProps): React.JSX.Element {
  // ...
}
```

约定：

- **props 接口显式声明**，用 `interface` 不用 `type`；props 名字用驼峰。
- **返回类型显式标注** `React.JSX.Element`（项目用 React 19 的 JSX 命名空间）。
- 图标统一从 `lucide-react` 引入，不要混用其他图标库。
- 组件文件与同名的 `.scss` 并列，组件内 `import './Xxx.scss'`。
- 组件导出用命名导出（`export function`），不用 `export default`——页面/组件按名引入。

## 2. 样式

**CSS Modules 不用，用 BEM 风格的全局类名 + SCSS 嵌套。** 现有组件都是这套（如
`jev-modal-header`、`jev-verdict-text`、`menu-item delete`）。

- 类名带组件前缀，避免全局冲突：`jev-*`、`chat-*`、`sns-*`。
- **颜色/间距一律用 CSS 变量**：`var(--primary)`、`var(--bg-tertiary)`、`var(--border-color)`、
  `var(--text-tertiary)` 等，不要硬编码十六进制（深浅色主题切换会失效）。
- 主题由 `themeStore` 提供，共 7 套：`cloud-dancer` / `corundum-blue` / `kiwi-green` /
  `spicy-red` / `teal-water` / `blossom-dream` / `geist`。
- 内联 `style={{...}}` 只用于一次性、动态计算的样式（如 `marginTop: 10` 的微调），不要在内联
  里写颜色。

### 开关控件（`.switch`）——踩过坑，特别注意

页面里的开关统一用这套结构：

```tsx
<label className="switch">
  <input type="checkbox" checked={value} onChange={...} />
  <span className="switch-slider" />
</label>
```

**滑块的类名必须是 `switch-slider`**（不是 `slider`）。SCSS 的选择器是
`.switch .switch-slider` 和 `input:checked + .switch-slider`，类名写错会让滑块零尺寸、
不渲染、不可点。`main.scss` 和各页面 `.scss` 里有多套 `.switch` 定义（全局 44×24、页面内
36×20），全部用同一个 `.switch-slider` 内部类名。

## 3. 状态管理

**全局状态用 zustand**（`src/stores/`，共 9 个：`appStore` / `chatStore` / `analyticsStore` /
`contactTypeCountsStore` / `imageStore` / `exportTaskStore` / `batchTranscribeStore` /
`batchImageDecryptStore` / `themeStore`）：

```ts
export interface AppState {
  isDbConnected: boolean
  dbPath: string | null
  // ...
}

export const useAppStore = create<AppState>()((set, get) => ({
  isDbConnected: false,
  dbPath: null,
  // ...
}))
```

- store 里定义 `interface XxxState`，字段 + 更新方法都放里面。
- **局部状态用 `useState`，不要什么都往 store 塞。** 跨页面/跨组件共享的才进 store。
- `exportTaskStore` 等带副作用的 store 里，异步逻辑放在方法内，不要在 store 顶层发 IPC。

## 4. 与主进程通信

**只走 `window.electronAPI`，不要想办法直接用 `ipcRenderer`**（preload 没有暴露它）。

推荐经由 `src/services/ipc.ts` 的封装调用，它已经按域分好：

```ts
import { config, dialog, windowControl } from '../services/ipc'

await config.set('jevEnabled', true)
```

`ipc.ts` 里没覆盖的命名空间可以直接用 `window.electronAPI.<域>.<方法>`。**主进程侧新增能力时，
三处要同步**：`electron/services/` 写实现 → `electron/main.ts` 注册 `ipcMain.handle` →
`electron/preload.ts` 暴露到 `electronAPI`。漏任一处渲染层都调不到。

## 5. 长列表与性能

聊天页、会话列表都是**虚拟列表**（`react-virtuoso`，项目里 20+ 处）。

**关键约束：虚拟列表的元素索引在一次渲染后就会失效。** 元素会随滚动/重渲染重新编号，
跨函数调用持有的索引再拿来点击会报「element index no longer refers to the element you saw
there」。**观察 → 定位 → 操作必须在同一个执行单元里完成**，不要把索引存到外面再异步用。

重渲染密集的列表：用 `React.memo` 包子项，key 用稳定的业务 id（`chatStore` 里有去重 key
生成逻辑可参考），不要用数组下标当 key。

## 6. 多窗口

渲染层所有窗口共用同一个 `dist/index.html`，靠 **hash 路由**区分：

- `/chat-window`、`/video-player-window`、`/image-viewer-window`、`/agreement-window`、
  `/notification-window` 等。
- 主进程在 `electron/main.ts` 建窗口时指定 `hash`，`src/App.tsx` 里要有对应路由。

**加新窗口改两处**，漏了会渲染成主窗口。

通知窗口：Windows 走 `@hicccc77/electron-liquid-glass` 原生玻璃面板（`components/LiquidGlass/`），
macOS / Linux 回退 `systemNotificationService`。主题自适应见
`pages/useNotificationAdaptiveTheme.ts`。

## 7. 国际化与文本

- 面向用户的文案用中文，直接写在 JSX 里（项目没有 i18n 框架）。
- 用户可见的**枚举值要有中文映射表**，不要直接显示后端英文 code：

  ```ts
  const TRUE_INTENT_LABELS: Record<string, string> = {
    confirm_you_care: '确认你还在乎',
    vent_anger: '发泄情绪',
    // ...
  }
  ```

- **不要把后端返回的对象直接插值到 JSX**，会渲染成 `[object Object]`。踩过这个坑：
  `answers.danger_level.legend` 是 `index→描述` 的对象，要自己写档位查找函数。
- 概率显示要显示**选中结论自己的把握**：`v < 0.5` 时选中否定态，否定态的把握是 `1 - v`，
  不是 `v`。

## 8. 安全相关（硬约束）

- **不写任何自动发送消息的代码**：不模拟回车、不模拟点发送、不调发信接口。候选回复只挂
  「复制到剪贴板」。
- **不碰转账/红包/收款**。
- API key 不进渲染层持久状态、不进日志、不写本地存储。Key 从 `electronAPI.config` 读出来
  用完即丢，不要 `console.log` 含 key 的对象。
- 渲染层报错文本要脱敏（主进程侧 `redactKey` 是统一出口；渲染层只展示主进程传来的已脱敏文本）。

## 9. 何时新建文件

- 新功能**优先落进 `electron/services/` 的独立文件**，不要往 `electron/main.ts` 或
  `chatService.ts` 里塞——这两个文件已经巨大，继续塞会无法维护。
- 渲染层新页面放 `src/pages/`，可复用控件放 `src/components/`，页面专属子组件放页面自己的
  子目录（参考 `pages/Chat/`、`pages/Export/`）。
- 大体积缓存状态走 `CacheMapStore`（`cacheMapStore.ts`），不要写进主配置。

## 相关文档

- `docs/ARCHITECTURE.md` — 架构、IPC 层、目录结构
- `docs/DEVELOPMENT.md` — 开发、构建、测试流程
- `AGENTS.md` — AI 协作规范与硬约束
