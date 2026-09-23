# WeFlow 设计规范（DESIGN）

这篇是给 AI agent（和人类协作者）看的**界面设计规范**：在 WeFlow 里加新页面、新组件、改样式时
该遵循什么。先读这篇，再动 `src/`。

**核心原则：设计令牌（design token）驱动。** 所有颜色、间距、圆角、阴影都通过 CSS 变量引用，
不硬编码。这样 7 套主题 + 深浅色模式才能整体切换，而不是逐个组件改。

---

## 1. 主题系统

### 1.1 双层结构：主题（theme）× 模式（mode）

WeFlow 的主题系统仿 ChatGPT 的 accent 机制，**分两层，不要混淆**：

- **模式（mode）**：`light` / `dark` / `system`。控制背景、文字、边框等**全部中性色**。
  由 `[data-mode="light"]` / `[data-mode="dark"]` 两组选择器定义。
- **主题（theme）**：7 套 accent 配色。**只覆盖 `--primary` 等品牌色**，背景文字保持不变。
  由 `[data-theme="<id>"]` 选择器定义，每套主题各有一个 `[data-theme="…"][data-mode="dark"]`
  的深色覆盖。

### 1.2 应用方式

`src/App.tsx` 把状态写到 `<html>` 的属性上：

```ts
document.documentElement.setAttribute('data-theme', currentTheme)   // cloud-dancer 等
document.documentElement.setAttribute('data-mode', effectiveMode)    // light | dark
```

**改主题变量只去 `src/styles/main.scss`**，不要在组件里写 `[data-theme=…]` 选择器。

### 1.3 可选主题（`src/stores/themeStore.ts`）

| id | 名称 | primary | 定位 |
|---|---|---|---|
| `cloud-dancer`（默认） | 云上舞白 | `#8B7355` | Pantone 2026 年度色，暖棕 |
| `blossom-dream` | 繁花如梦 | `#D4849A` | 晨曦花境，多彩（有 accent `#FFBE98`） |
| `corundum-blue` | 刚玉蓝 | `#4A6670` | RAL 220 40 10 |
| `kiwi-green` | 冰猕猴桃汁绿 | `#7A9A5C` | RAL 120 90 20 |
| `spicy-red` | 辛辣红 | `#8B4049` | RAL 030 40 40 |
| `teal-water` | 明水鸭色 | `#5A8A8A` | RAL 180 80 10 |
| `geist` | Geist | `#000000` | Vercel 极简黑白 |

状态在 `themeStore`（zustand + persist，key `echotrace-theme`）。

---

## 2. 设计令牌（CSS 变量）

**这是唯一应该出现在组件样式里的「颜色值」来源。** 完整定义见 `src/styles/main.scss`。

### 品牌色

```
--primary              主操作色（按钮、开关打开态、选中态、链接）
--primary-rgb          主色的 RGB 逗号分隔（用于 rgba()：rgba(var(--primary-rgb), 0.2)）
--primary-hover        hover 加深
--primary-light        半透明主色（浅色底/徽章背景）
--primary-gradient     主色渐变（强调区域，如空状态插图）
```

### 中性色（随 mode 变化）

```
--bg-primary           页面最底层背景
--bg-secondary         次级背景（区块、侧栏）
--bg-tertiary          三级背景（控件底、禁用态）
--bg-hover             悬停反馈
--bg-sidebar           侧栏专用背景
--bg-gradient          页面渐变（一些大背景用它而不是纯色）

--text-primary         主文字（标题、正文重点）
--text-secondary       次级文字（说明、时间戳）
--text-tertiary        三级文字（占位、禁用、icon）

--border-color         分隔线 / 描边
--border-radius        全局圆角（12px）
```

### 语义色与其它

```
--danger               危险/错误（删除按钮、报错）
--warning              警告
--card-bg              卡片背景
--card-inner-bg        卡片内嵌区块背景
--sent-card-bg         聊天气泡「我发出的」底色（默认 = --primary）
--on-primary           主色之上的文字色（按钮文字）
--shadow-sm            小阴影（卡片、弹层）
--shadow-md            中阴影（悬浮卡片、模态框）
--gold-start/mid/end   会员金色渐变（仅特定付费/年报区域）
```

### 硬性规则

- **禁止硬编码十六进制颜色。** `color: #8B7355` 是错的，`color: var(--primary)` 是对的。
  例外：`main.scss` 里定义令牌本身的时候。
- **禁止用 `rgba(0,0,0,0.x)` 之类的写死透明度叠层**模拟深浅色——深浅色由 mode 切换提供，
  硬叠会在另一模式下发灰。需要半透明主色用 `--primary-light` 或 `rgba(var(--primary-rgb), α)`。
- 新增语义色先想清楚「它在另一模式下该是什么」，两个 mode 都要在 `main.scss` 里定义。

---

## 3. 字号与间距

项目没有严格的 type scale，**实际约定如下**（统计自现有代码）：

| 用途 | 字号 | 出现位置 |
|---|---|---|
| 次要说明、时间戳、徽章 | 11–12px | 消息元信息、`form-hint`、列表小字 |
| 正文 / 列表项 / 按钮 | 13–14px | 消息文字、`btn`（14px）、设置项 |
| 小标题 | 15–16px | 卡片标题、区块标题 |
| 页面标题 | 18px | 弹窗标题、页面大标题 |

- **不要引入 20px 以上的正文级字号**；大标题最多 18px。桌面应用信息密度高，字号体系偏紧凑。
- 行高默认即可；长文本（消息正文）用 1.5–1.6。
- 间距用 **8 的倍数**（8 / 12 / 16 / 24）；细调用 4。不要出现 7px、13px 这类值。
- 组件内边距：卡片 `16px`（`.card` 约定），按钮 `8px 16px`（`.btn` 约定）。

---

## 4. 复用组件类（不要重造）

`src/styles/main.scss` 里已有全局通用类，**新组件优先复用**：

### 按钮 `.btn`

```tsx
<button className="btn btn-primary">主操作</button>
<button className="btn btn-secondary">次操作</button>
```

- `btn-primary`：`--primary` 底 + `--on-primary` 字，hover 变 `--primary-hover`。
- `btn-secondary`：`--bg-tertiary` 底 + `--text-primary` 字，hover 变 `--bg-hover`。
- 禁用态两者都是 `opacity: 0.5; cursor: not-allowed`，不要自己写 disabled 样式。
- 危险操作（删除）：没有全局 `.btn-danger`，用 `btn-secondary` + `color: var(--danger)` 覆盖字色。

### 卡片 `.card`

```tsx
<div className="card">…</div>
```

`--card-bg` 底、`--border-radius`（12px）圆角、`16px` 内边距。区块容器一律用它。

### 开关 `.switch`（踩过大坑，必读）

```tsx
<label className="switch">
  <input type="checkbox" checked={value} onChange={…} />
  <span className="switch-slider" />
</label>
```

- **内部滑块的类名必须是 `switch-slider`**，不是 `slider`。SCSS 选择器是
  `.switch .switch-slider` 与 `input:checked + .switch-slider`，类名错会让滑块**零尺寸、
  不渲染、不可点**——这个 bug 真实发生过（Jev 启用开关）。
- `main.scss` 的 `.switch` 是 44×24；部分页面（如 `SettingsPage.scss`）另有 36×20 的覆盖，
  内部类名相同。尺寸不同不影响类名约定。
- 可选增强：给 `input` 加 `id` + label 的 `htmlFor`（`switch-input` 类名），便于无障碍聚焦。

### 表单 `.form-group` / `.form-hint`

设置页统一结构（见 `SettingsPage.scss`）：

```tsx
<div className="form-group">
  <label>设置项名</label>
  <span className="form-hint">这一段是给用户看的解释，说明开了会怎样。</span>
  {/* 控件 */}
</div>
```

- `form-hint` 是 12px 的 `--text-secondary` 说明文字。**每个有副作用的设置项都要写 hint**，
  用户需要知道这个开关到底干什么。
- 禁用的设置项用 `.form-group.disabled`。
- 开关 + 状态文字的行布局：`.toggle-row` 包 `.switch` 和 `.log-status`（已开启/已关闭）。

### 分隔 `.divider`

区块之间的分隔线，用 `--border-color`。

---

## 5. 聊天界面专项

聊天气泡、消息列表的样式在 `src/styles/chat-patterns.scss`（被 `main.scss` 引入）。

- 我发出的气泡底色 `var(--sent-card-bg)`（默认就是主色），对方气泡 `var(--card-bg)`。
- 消息列表是**虚拟列表**（`react-virtuoso`），样式要考虑「只渲染可见区域」——
  不要写依赖完整列表 DOM 的选择器（如 `li:last-child`），可能永远不匹配。
- 聊天页右键菜单（`contextMenu` 状态）的菜单项类名是 `.menu-item`，危险项追加 `.delete`。

---

## 6. 通知与多窗口的视觉

- **Windows 通知**走 `@hicccc77/electron-liquid-glass` 原生玻璃面板（`src/components/LiquidGlass/`），
  内容绘制在透明背景上——**通知窗口内的组件不能假设有不透明背景**，文字色要能压在任意壁纸之上。
- macOS / Linux 回退系统通知（`systemNotificationService`）。
- 通知窗口主题自适应见 `src/pages/useNotificationAdaptiveTheme.ts`。

---

## 7. 无障碍

- 所有可点击的非文字元素给 `aria-label`（图标按钮必须有）。
- 开关用原生 `<input type="checkbox">` 而不是 `div` 模拟，保证键盘可操作。
- 模态框关闭按钮给 `aria-label="关闭"`。
- 颜色对比度：`--text-tertiary` 只用于**非必要的辅助信息**，不要用在用户必须读懂的文字上。

---

## 8. 新增主题 / 令牌的流程

1. 在 `src/styles/main.scss` 加 `[data-theme="<id>"]`（亮）和
   `[data-theme="<id>"][data-mode="dark"]`（暗）两组规则，**只覆盖 `--primary` 家族**。
2. 在 `src/stores/themeStore.ts` 的 `themes` 数组和 `ThemeId` 类型里加上。
3. 主题是用户可见选项，**两个 mode 都要实际看一眼**再合并（深色下的对比度和亮色下差别很大）。
4. 在 `CHANGELOG.md` 记一笔。

---

## 9. 什么时候可以偏离规范

- 媒体内容（图片、视频缩略图、年报可视化）的颜色不受令牌约束——它们是内容不是 UI。
- 年报、双人报告的**喜庆性视觉**（金色渐变 `--gold-*`、节日配色）是刻意为之的例外，
   集中在报告相关组件里，不要扩散到常规界面。
- 第三方图表库（echarts）的配色在 JS 里配，不能直接吃 CSS 变量——取当前主题色时
  从 `getThemeInfo(themeId).primaryColor` 读。

---

## 相关文档

- `docs/COMPONENT-GUIDELINES.md` — 组件写法、状态管理、IPC（和本文配套，一个讲结构一个讲视觉）
- `docs/ARCHITECTURE.md` — 架构与目录
- `AGENTS.md` — AI 协作规范与硬约束
