# 播放器全屏功能修复计划

## 问题根因分析

### 核心结论（已确认）

根据**Apple官网文档**（https://developer.apple.com/documentation/webkit/wkpreferences/iselementfullscreenenabled）：

> **The default value for this preference is `false`.**

**问题根因链**：
1. Tauri使用wry库，wry使用WKWebView
2. WKWebView的`isElementFullscreenEnabled`默认值为`false`
3. Web Fullscreen API被禁用，`document.fullscreenEnabled`返回`false`
4. Vidstack检测到`canFullscreen = false`，默认全屏按钮被隐藏或不渲染

## 已排除方案（记录所有犯过的错误）

### 错误1：`FullscreenButton`从错误模块导入
- **尝试**：从`@vidstack/react/player/layouts/default`导入`FullscreenButton`
- **结果**：构建失败，该模块无此导出
- **教训**：`FullscreenButton`应从`@vidstack/react`主模块导入

### 错误2：使用`FullscreenButton`组件
- **尝试**：使用Vidstack的`FullscreenButton`组件替换默认按钮
- **结果**：按钮被隐藏，因为组件仍检查`canFullscreen`状态
- **教训**：`FullscreenButton`组件依赖`canFullscreen`状态，在Tauri环境下不可用

### 错误3：使用`slots.fullscreenButton`
- **尝试**：通过`slots.fullscreenButton`放入自定义按钮
- **结果**：按钮不可见，因为Vidstack在`canFullscreen=false`时不渲染此slot
- **教训**：`fullscreenButton` slot受`canFullscreen`状态控制

### 错误4：图标从`@vidstack/react/icons`导入
- **尝试**：从`@vidstack/react/icons`导入`FullscreenIcon/FullscreenExitIcon`
- **结果**：构建失败，缺少`media-icons`依赖
- **教训**：使用SVG直接绘制图标，避免依赖额外包

### 错误5：使用不存在的slot名称
- **尝试**：使用`afterSettingsButton` slot
- **结果**：类型报错，该slot不存在
- **教训**：slot名称必须从Vidstack类型定义中确认

### 错误6：使用Tauri窗口级全屏API代替元素级全屏
- **尝试**：调用`getCurrentWindow().setFullscreen(true)`实现全屏
- **结果**：整个APP窗口全屏，不是用户想要的播放器元素级全屏
- **教训**：用户明确说"APP全屏我点APP的操作系统自带的全屏按钮即可"，不要使用窗口级全屏API

### 错误7：自定义全屏按钮（绝对定位）
- **尝试**：在播放器容器外添加绝对定位的自定义全屏按钮，调用Tauri窗口全屏API
- **结果**：按钮可见可点击，但实现的是窗口级全屏，不是用户想要的
- **教训**：根本问题不是按钮是否可点击，而是WKWebView的Web Fullscreen API被禁用

## 正确解决方案

### 方案：启用Tauri的`macOSPrivateApi`配置

**原理**：根据Tauri官网文档，启用`macOSPrivateApi: true`会自动设置WKWebView的`isElementFullscreenEnabled`为`true`，让Web Fullscreen API正常工作。

**修改文件**：`apps/desktop/src-tauri/tauri.conf.json`

**修改内容**：在`app`配置中添加`"macOSPrivateApi": true`

**效果**：
- Web Fullscreen API被启用，`document.fullscreenEnabled`返回`true`
- Vidstack检测到`canFullscreen = true`，默认全屏按钮自动显示
- 用户点击全屏按钮时，播放器进入元素级全屏（真正的全屏）
- 不需要任何自定义按钮或hack

## 文件修改清单

| 文件路径 | 修改内容 | 说明 |
|---------|---------|------|
| `apps/desktop/src-tauri/tauri.conf.json` | 添加`"macOSPrivateApi": true` | 启用WKWebView的Web Fullscreen API |
| `apps/desktop/src/components/player/VideoPlayer.tsx` | 移除所有自定义全屏代码 | 恢复Vidstack默认全屏按钮 |

## 详细步骤

### 步骤1：修改Tauri配置

在`tauri.conf.json`的`app`配置中添加`macOSPrivateApi: true`：

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [...]
}
```

### 步骤2：清理自定义全屏代码

从VideoPlayer.tsx中移除：
- `isFullscreen`状态
- `handleEnterFullscreen`/`handleExitFullscreen`/`handleFullscreenToggle`函数
- Tauri窗口全屏API调用（`setFullscreen`）
- 全屏快捷键监听（Esc键）
- 自定义全屏按钮
- `getCurrentWindow`导入和自定义图标组件

### 步骤3：重启应用

由于修改了Tauri配置，需要重启APP才能生效。

## 预期效果

- Vidstack的原生全屏按钮自动显示在播放器控制栏上
- 点击全屏按钮后，播放器进入元素级全屏（真正的全屏）
- 全屏状态变化时，按钮图标正确切换（全屏/退出全屏）
- 按Esc键或点击退出全屏按钮，播放器恢复正常大小
- 控制台无错误提示

## 风险与注意事项

### 风险点
1. **macOSPrivateApi兼容性**：启用此选项后，应用可能无法通过Mac App Store审核（因为使用了私有API）
2. **Tauri版本要求**：此配置在Tauri v2中可用

### 注意事项
1. 必须重启APP才能生效（配置变更）
2. 不需要任何前端代码修改，依赖WKWebView的原生能力

## 参考文档

1. Apple官方文档：https://developer.apple.com/documentation/webkit/wkpreferences/iselementfullscreenenabled
2. Tauri配置文档：https://tauri.app/v1/api/config/#macosprivateapi
3. Vidstack文档：https://vidstack.io/docs/player/components/layouts/default