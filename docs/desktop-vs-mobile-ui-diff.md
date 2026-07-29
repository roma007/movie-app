# 桌面端 vs 移动端 UI 差异清单

> 生成时间：2026-07-27
> 用途：记录桌面端已有的 UI 特性中可复用到移动端的部分，按优先级排列

---

## 一、功能特性差异

### 高优先级

| # | 特性 | 桌面端现状 | 移动端现状 | 复用建议 |
|---|------|-----------|-----------|---------|
| 1 | MediaCard Badge 状态标签 | 卡片左上角显示"更新至第X集"/"完结 全X集" | 完全缺失 | 用 RN 绝对定位叠加层实现 |
| 2 | MediaCard 演员信息 | 卡片下方显示前2位演员名 | 缺失 | 改动一行 |
| 3 | MediaCard 年份+地区 | 显示"年份 · 地区" | 仅显示年份，缺地区 | 改动一行 |
| 4 | 详情页导演/主演可点击搜索 | 点击演员名跳转首页自动搜索其作品 | 仅为纯文本 | navigate + searchKeyword |
| 5 | 采集进度浮窗 CollectProgressDialog | 增量采集时实时展示每个源的进度 | 仅 Alert 提示 | 新建 RN 组件 |
| 6 | 设置页片尾下一集提示 UI | 有开关 + 阈值时间选择 | store 已有状态，缺 UI 控件 | SettingsScreen 补充 |
| 7 | 字体大小调节 | 支持多档字体大小选择 | 缺失 | store + SettingsScreen |

### 中优先级

| # | 特性 | 桌面端现状 | 移动端现状 |
|---|------|-----------|-----------|
| 8 | 色彩控制面板 ColorControls | 亮度/对比度/饱和度/色调实时调节 | 无 |
| 9 | AnnouncementDialog 通知弹窗 | 首次打开重要信息通知 | 无 |
| 10 | 分类页搜索 | 分类页顶部搜索框 | 无 |
| 11 | 搜索采集黑名单/年份选项 | 首页搜索采集的高级控制开关 | 无 |
| 12 | DiagnosticLogViewer 诊断日志 | 内嵌式日志查看器 | 无 |
| 13 | 播放页面包屑导航 | "类型 > 标题 > 集数"导航链 | 仅显示标题 |

### 低优先级

| # | 特性 | 桌面端现状 | 移动端现状 |
|---|------|-----------|-----------|
| 14 | BitrateOverlay 码率显示 | 播放器分辨率和码率信息 | 无 |
| 15 | 首页追剧缩略图+集数名+查看更多 | 追剧卡片显示缩略图和当前集数 | 无 |
| 16 | 主题配置补全 secondaryForeground | 已定义并使用 | 缺此变量 |

### 无需迁移（两端已一致或移动端更优）

- NextEpisodeOverlay（两端都有）
- UsageGuideDialog/Modal（两端都有）
- FilterDropdown（移动端实现更优，支持年份十年分组）
- BlurredBackground（两端都有）
- AiSourceImport（功能已存在，形态不同）
- 已播剧集变灰（两端已一致）
- Grid/List 视图切换（移动端屏幕有限，不适用）
- 分页导航器（移动端无限滚动更自然）

---

## 二、UI 细节差异（12维度深度分析）

### 1. 卡片透明度

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 默认值 | 85 | 85 |
| 存储方式 | localStorage | AsyncStorage |
| 渲染方式 | CSS 静态变量 `--color-card-alpha` | `hexToRgba()` 动态计算 |
| 动态调节 | store 有 cardOpacity，但 CSS 变量未动态更新 | 完全动态，每次 re-render 重新计算 |
| 透明度可调 | 设置页有滑块控制 | 设置页有滑块控制（10%-100%） |

**结论**：移动端的 hexToRgba 方案更灵活，桌面端应跟进动态更新 CSS 变量。

### 2. 背景图处理

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 架构 | 全局单例 BackgroundLayer（fixed 定位） | 每页各自包裹 BlurredBackground |
| 磨砂实现 | CSS `backdropFilter` | expo-blur `BlurView` |
| 模糊实现 | CSS `filter: blur()` on backgroundImage | RN Image `blurRadius` |
| 遮罩 | body background-color 透明 | 额外 30% 黑色遮罩层 |
| Fallback | `/assets/default-poster.jpg` | 本地 `require()` |

**结论**：两端架构不同但效果一致，保持各自实现即可。

### 3. 按钮样式和交互

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 组件化 | 完整 `<Button>` 组件，6 种 variant | 无统一组件，各页面内联样式 |
| 圆角 | rounded-md（8px） | 多种（6px / 8px）不统一 |
| 过渡动画 | `transition-all duration-200` | 无过渡动画 |
| Hover 效果 | `hover:bg-[var(--color-hover-alpha)]` | TouchableOpacity opacity 反馈 |
| Focus 效果 | `focus-visible:ring-2 ring-ring` | 无 |
| 禁用状态 | `disabled:opacity-50 disabled:pointer-events-none` | `opacity: 0.5` |

桌面端 Button 6种 variant：

| variant | 样式 |
|---------|------|
| default | `bg-primary-light text-foreground hover:bg-hover-alpha` |
| destructive | `bg-destructive text-destructive-foreground` |
| outline | `bg-secondary-alpha text-text-secondary hover:bg-hover-alpha` |
| secondary | `bg-secondary-alpha text-secondary-foreground hover:bg-hover-alpha` |
| ghost | `hover:bg-hover-alpha hover:text-foreground` |
| link | `text-primary underline-offset-4 hover:underline` |

**结论**：移动端应提取统一 Button 组件，参考桌面端 variant 设计。

### 4. 进度条样式

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 播放进度条 | Vidstack DefaultVideoLayout | expo-video 系统控件 |
| 追剧进度条高度 | 4px (h-1) | 4px |
| 追剧进度条背景 | `secondary-alpha` | `colors.borderLight` |
| 追剧进度条进度色 | `bg-primary` | `colors.primary` |
| 追剧进度条圆角 | rounded-full | borderRadius: 2 |
| 追剧进度条过渡 | `transition-all` | 无 |
| 采集进度条 | 固定面板，文字进度 | 无此组件 |

追剧进度条 HTML 对比：

```html
<!-- 桌面端 -->
<div class="w-full bg-[var(--color-secondary-alpha)] rounded-full h-1 mt-1">
  <div class="bg-primary h-1 rounded-full transition-all" style="width: ${pct}%" />
</div>
```

```tsx
// 移动端
progressBar: { height: 4, backgroundColor: colors.borderLight, borderRadius: 2, overflow: 'hidden' },
progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
```

### 5. 文字字色体系

桌面端 CSS 变量默认值：

```
--color-foreground: #fafafa          (主文字)
--color-muted-foreground: #a0a0a0    (辅助/次要文字)
--color-disabled-foreground: #666666 (禁用文字)
--color-secondary-foreground: #fafafa(次要前景)
--color-text-secondary: #000000      (非文本语义)
```

移动端 ThemeColors：

```
foreground: '#f1f5f9'        // 主文字
text: '#ffffff'              // 额外文字字段
textSecondary: '#000000      // 正文颜色（语义与桌面端不同）
mutedForeground: '#999999'   // 辅助文字
disabledForeground: '#666666'// 禁用文字
```

各场景颜色对比：

| 场景 | 桌面端 | 移动端 |
|------|--------|--------|
| 页面标题 | `text-lg font-medium` (foreground) | `fontSize: 28, color: colors.text` |
| 卡片标题 | `text-sm font-medium` (foreground) | `fontSize: 16, color: colors.text` |
| 卡片描述 | `text-xs text-secondary-foreground` | `fontSize: 12, color: colors.mutedForeground` |
| 剧情介绍正文 | `text-sm leading-6 text-foreground` | `fontSize: 14, color: colors.textSecondary` |
| 更新时间 | `text-error`（红色） | `colors.favorite`（红色） |
| 空状态文字 | `text-muted-foreground` | `colors.mutedForeground` |
| 选中项文字 | `text-primary` | `colors.primary` |

关键差异：
1. `textSecondary` 语义不同：桌面端用于 sidebar 项，移动端用于正文
2. `mutedForeground` 色值不同：桌面端 `#a0a0a0`，移动端 `#999999`
3. 更新时间：桌面端用 `error` 色，移动端用 `favorite` 色

### 6. 卡片交互效果

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 交互方式 | CSS hover + transition | TouchableOpacity activeOpacity |
| 图片放大 | `group-hover:scale-105 transition-transform duration-300` | 无 |
| 阴影变化 | `hover:shadow-card` | 无 |
| 背景变化 | `hover:bg-secondary/50` | 无 |
| 过渡时间 | `duration-300` | 无 |
| 按压缩放 | 无 | `activeOpacity={0.8}` |

首页追剧卡片交互：

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 追剧列表项 | `hover:bg-secondary/50 cursor-pointer` | TouchableOpacity 按压反馈 |
| 水平列表 | `<MediaCard size="small">` hover 图片放大 | `<MediaCard compact>` activeOpacity |
| 续看按钮 | `<Button variant="ghost">` | 纯文字 `colors.primary` |

**结论**：移动端可考虑用 Animated API 实现按压缩放（scale 0.98）替代仅 opacity 降低。

### 7. Badge/Tag 标签样式

桌面端 Badge 组件 4 种 variant：

| variant | 样式 |
|---------|------|
| default | `bg-primary text-primary-foreground rounded-full` |
| secondary | `bg-secondary text-secondary-foreground rounded-full` |
| destructive | `bg-destructive text-destructive-foreground rounded-full` |
| outline | `text-foreground rounded-full` |

桌面端 MediaCard 中的 Badge：
- 更新中：`bg-primary/80 backdrop-blur-sm border-none text-white`
- 完结：`bg-muted-foreground/80 backdrop-blur-sm border-none text-white`

移动端：
- **无 Badge 组件**
- MediaCard **无状态标签**
- DetailScreen genre 标签：`borderRadius: 4`（圆角矩形，非药丸型）

### 8. 输入框样式

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 组件化 | `<Input>` 组件 | 无统一组件 |
| 高度 | h-10 (40px) | paddingVertical: 10 (~36px) |
| 圆角 | rounded-md (8px) | borderRadius: 8 |
| 背景色 | `input-alpha` (rgba(42,42,42,0.77)) | surfaceBg (hexToRgba) |
| Focus 效果 | ring-2 + ring-offset | 无 |
| Placeholder 颜色 | `text-muted-foreground` | 系统默认 |
| 禁用样式 | `disabled:opacity-50` | 无 |

桌面端 Input 样式：
```css
flex h-10 w-full rounded-md bg-[var(--color-input-alpha)] px-3 py-2 text-base
ring-offset-background placeholder:text-muted-foreground
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
disabled:cursor-not-allowed disabled:opacity-50
```

### 9. Switch/Toggle 样式

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 实现 | Radix UI Switch / 手写 button 模拟（两套不统一） | RN 原生 Switch |
| 打开颜色 | 绿色 #22c55e / bg-primary（两套） | colors.primary（跟随主题） |
| 关闭颜色 | surface-alpha / muted-foreground/30 | colors.switchTrack（#333333） |
| 滑块颜色 | var(--color-foreground) 白色 | primaryForeground / disabledForeground |
| 尺寸 | 44x24 / 40x20（两套不统一） | 系统默认（~51x31） |
| 动画 | CSS transition | 系统原生动画 |

桌面端存在两套 Switch 实现，应统一。

### 10. 分割线/边框

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| border 变量 | `#2a2a2a` | `#2a2a2a` |
| borderLight | 无此变量 | `#333333`（移动端独有） |
| 显式边框使用 | 常见（Card 分割、表格） | 极少，靠背景色差异分隔 |
| 分隔方式 | 边框 + divide | 间距 + 背景色差异 |
| borderHighlight | 各主题不同 | 始终 `rgba(74, 158, 255, 0.6)` |

### 11. 阴影效果

桌面端 3 级阴影体系：

```css
--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.3)
--shadow-modal: 0 4px 12px rgba(0, 0, 0, 0.4)
--shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.5)
```

| 维度 | 桌面端 | 移动端 |
|------|--------|--------|
| 阴影定义 | 3 级（card/modal/overlay） | 无 |
| 使用频率 | 高（卡片、弹窗、菜单） | 无 |
| card-shadow | `0 1px 3px rgba(0,0,0,0.3)` | 不适用 |

**结论**：移动端暗色主题下阴影效果不明显，但浅色主题和弹窗场景可考虑补充 elevation/shadow。

### 12. 圆角

桌面端 3 级圆角体系：

```css
--radius-sm: 4px
--radius-md: 8px
--radius-lg: 12px
```

各组件圆角对比：

| 组件 | 桌面端 | 移动端 |
|------|--------|--------|
| Card | 12px (rounded-lg) | 8px |
| Button | 8px (rounded-md) | 6-8px（不统一） |
| Badge | 9999px (rounded-full) | 无 Badge |
| Input | 8px (rounded-md) | 8px |
| Poster | 12px | 8px |
| 芯片/Tag | 无 | 6px |
| 进度条 | 9999px (rounded-full) | 2px |
| 首页卡片 | 12px | 12px |
| Genre 标签 | 无 | 4px |

**结论**：移动端应统一为 3 级圆角体系：sm=4px, md=8px, lg=12px, full=9999px。

---

## 三、主题配置差异

### 桌面端独有颜色变量

| 变量 | 用途 | 移动端是否需要 |
|------|------|---------------|
| sidebar | 侧边栏背景色 | 不需要（无侧边栏） |
| hover | 悬停状态背景色 | 不需要（无 hover） |
| popover | 弹出层背景色 | 可用 card 替代 |
| popoverForeground | 弹出层前景色 | 可用 foreground 替代 |
| secondary | 次要按钮/区域背景色 | 可用 surface 替代 |
| secondaryForeground | 次要前景色 | **需要**（卡片辅助文字） |
| accent | 强调色背景 | 可用 primaryLight 替代 |
| accentForeground | 强调色前景 | 不需要 |
| destructive | 危险操作色 | 可用 error 替代 |
| destructiveForeground | 危险操作前景色 | 可用 error 替代 |
| ring | 焦点环颜色 | 不需要 |

### 移动端独有颜色变量

| 变量 | 用途 |
|------|------|
| text | 正文主色 |
| borderLight | 更浅的边框色 |
| switchTrack | Switch 控件轨道色 |
| overlay | 遮罩层颜色 |
| playerBg | 播放器背景色 |
| playerHeader | 播放器顶栏色 |

### 各主题 secondaryForeground 参考值（桌面端已定义）

| 主题 | 值 |
|------|-----|
| dark (暗夜黑) | `#fafafa` |
| light (晨曦白) | `#000000` |
| ocean (深海蓝) | `#e0f2fe` |
| forest (森林绿) | `#dcfce7` |
| sunset (落日橙) | `#ffedd5` |
| purple (紫罗兰) | `#f3e8ff` |

---

## 四、实施计划

### 高优先级（先做）

| # | 任务 | 涉及文件 |
|---|------|---------|
| 1 | MediaCard 补充 Badge 状态标签 + 演员信息 + 地区 | `mobile/src/components/MediaCard.tsx` + 新建 Badge |
| 2 | 详情页导演/主演可点击搜索 | `mobile/src/pages/DetailScreen.tsx` |
| 3 | 采集进度浮窗 | 新建 `mobile/src/components/CollectProgressDialog.tsx` + HomeScreen |
| 4 | 设置页片尾下一集提示 UI | `mobile/src/pages/SettingsScreen.tsx` |
| 5 | 字体大小调节 | `mobile/src/pages/SettingsScreen.tsx` + store |
| 6 | 主题配置补全 secondaryForeground | `mobile/src/themes/types.ts` + `config.ts` |

### 中优先级

| # | 任务 | 涉及文件 |
|---|------|---------|
| 7 | 色彩控制面板 | 新建 `mobile/src/components/ColorControls.tsx` + PlayScreen |
| 8 | 通知弹窗 | 新建 `mobile/src/components/AnnouncementDialog.tsx` |
| 9 | 分类页搜索 | `mobile/src/pages/CategoryScreen.tsx` |
| 10 | 搜索采集黑名单/年份选项 | `mobile/src/pages/HomeScreen.tsx` |
| 11 | 诊断日志查看器 | 新建 `mobile/src/components/DiagnosticLogViewer.tsx` |
| 12 | 播放页面包屑导航 | `mobile/src/pages/PlayScreen.tsx` |

### 低优先级（UI 统一）

| # | 任务 | 涉及文件 |
|---|------|---------|
| 13 | 提取统一 Button 组件 | 新建 `mobile/src/components/ui/Button.tsx` |
| 14 | 提取统一 Input 组件 | 新建 `mobile/src/components/ui/Input.tsx` |
| 15 | 统一圆角体系 (4/8/12px) | 各组件 StyleSheet |
| 16 | 弹窗阴影补充 | 各 Modal/弹窗组件 |
| 17 | 卡片按压缩放效果 (scale 0.98) | `mobile/src/components/MediaCard.tsx` |
| 18 | 首页追剧缩略图+集数名+查看更多 | `mobile/src/pages/HomeScreen.tsx` |
| 19 | Switch 统一桌面端两套实现 | `desktop/src/components/ui/switch.tsx` + SettingsPage |
