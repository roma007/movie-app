# 播放器全屏功能实现计划

## 问题分析

**问题现象**：播放器全屏按钮点击后没有任何效果，控制台也没有错误提示。

**根本原因**：在Tauri桌面应用环境中，浏览器原生的Web Fullscreen API被限制或不可用，导致Vidstack播放器的默认全屏行为失效。

**用户需求**：实现真正的系统级全屏播放，即让播放器占据整个显示器屏幕，而不是仅仅放大播放器尺寸并隐藏其他元素。

## 技术方案

根据Vidstack和Tauri官网文档，解决方案如下：

### 1. Vidstack全屏机制
- Vidstack使用标准Web Fullscreen API实现全屏
- 提供`onFullscreenChange`和`onFullscreenError`事件监听
- 提供`enterFullscreen()`/`exitFullscreen()`方法

### 2. Tauri全屏机制
- 使用`@tauri-apps/api/window`模块的`getCurrentWindow().setFullscreen()`方法
- 需要配置相应的窗口权限

### 3. 实现策略
- **拦截Vidstack全屏事件**：监听`onFullscreenChange`事件
- **使用Tauri窗口API**：调用`setFullscreen(true/false)`实现系统级全屏
- **同步状态**：确保Vidstack的全屏状态与Tauri窗口状态一致
- **隐藏其他UI**：全屏时隐藏应用的侧边栏、顶部导航等非播放器元素

## 文件修改清单

| 文件路径 | 修改内容 | 说明 |
|---------|---------|------|
| `apps/desktop/src-tauri/capabilities/default.json` | 添加全屏相关权限 | Tauri窗口权限配置 |
| `apps/desktop/src/components/player/VideoPlayer.tsx` | 实现全屏逻辑 | 拦截Vidstack事件，调用Tauri API |
| `apps/desktop/src/components/player/VideoPlayer.tsx` | 添加全屏状态管理 | 同步Vidstack与Tauri的全屏状态 |

## 详细步骤

### 步骤1：配置Tauri窗口权限

在`apps/desktop/src-tauri/capabilities/default.json`中添加以下权限：

```json
{
  "permissions": [
    ...,
    "core:window:allow-set-fullscreen",
    "core:window:allow-is-fullscreen",
    "core:window:default"
  ]
}
```

### 步骤2：修改VideoPlayer组件

在`VideoPlayer.tsx`中：

1. 导入Tauri窗口API
2. 添加全屏状态管理
3. 监听Vidstack全屏事件并使用Tauri API实现全屏
4. 处理Esc键退出全屏

### 步骤3：测试验证

1. 运行开发服务器
2. 点击播放器全屏按钮
3. 验证窗口是否进入系统级全屏
4. 按Esc键验证是否退出全屏

## 风险与注意事项

### 风险点
1. **权限配置错误**：如果权限未正确配置，`setFullscreen`调用会失败
2. **状态不同步**：Vidstack的全屏状态与Tauri窗口状态可能不一致
3. **平台兼容性**：macOS和Windows的全屏行为可能略有差异

### 注意事项
1. 必须确保在用户交互回调中调用`setFullscreen`（Tauri安全限制）
2. 需要处理全屏状态变化的双向同步
3. 退出全屏时需要恢复应用的其他UI元素

## 预期效果

- 点击播放器全屏按钮后，窗口进入系统级全屏（无边框，占据整个显示器）
- 按Esc键或点击退出全屏按钮，窗口恢复正常大小
- 全屏状态在Vidstack播放器和Tauri窗口之间保持同步