# 播放器迁移方案：原生 video + hls.js → Vidstack Default Layout

## Context

当前桌面端播放器（[VideoPlayer.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/components/player/VideoPlayer.tsx)）用原生 `<video controls>` + hls.js + 自定义 TauriLoader（绕过 CORS）实现，只提供浏览器默认的基础控制条，**没有设置菜单**（倍速、画质切换、字幕等），也无法满足之前要求的"进度条显示预加载进度"和"左侧显示当前时间/总时长"。

迁移到 Vidstack（@vidstack/react）的 Default Layout 可获得开箱即用的设置菜单、进度条预加载显示、时间格式控制、倍速播放、画质切换、画中画、全屏快捷键等能力，同时保留现有的 TauriLoader、多播放源自动切换、观看进度保存等核心逻辑。

## 技术选型确认

- **库**：`@vidstack/react`（1.12.x 稳定版，支持 React 19）
- **布局**：DefaultVideoLayout（生产就绪模板，自带设置菜单）
- **HLS**：复用已安装的 `hls.js ^1.6.16`，通过 `provider.library = HLS` 本地加载（不走 CDN）
- **TauriLoader 保留方式**：通过 `provider.config = { loader: TauriLoader, enableWorker: false }` 注入

## 文件改动清单

| 文件 | 操作 | 说明 |
|---|---|---|
| [apps/desktop/package.json](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/package.json) | 修改 | 新增 `@vidstack/react` 依赖 |
| apps/desktop/src/components/player/TauriLoader.ts | **新建** | 从 VideoPlayer.tsx 抽取 TauriLoader 类为独立模块 |
| [apps/desktop/src/components/player/VideoPlayer.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/components/player/VideoPlayer.tsx) | **重写** | 替换为 Vidstack 实现 |
| [apps/desktop/src/main.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/main.tsx) | 修改 | 引入 Vidstack 默认布局 CSS（1 行） |
| [apps/desktop/src/index.css](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/index.css) | 修改 | 追加品牌色变量覆盖（约 5 行） |
| [apps/desktop/src/pages/PlayPage.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/pages/PlayPage.tsx) | **不改** | props 接口完全兼容 |

## 实现步骤

### 1. 安装依赖

```bash
pnpm --filter @movie-app/desktop add @vidstack/react@^1.12.13
```

- 根 package.json 的 `pnpm.overrides`（react/react-dom 锁 19.2.3）**无需修改**
- hls.js 已 hoisted 在 root node_modules，Vidstack 通过 `provider.library = HLS` 复用

### 2. 新建 TauriLoader.ts

路径：`apps/desktop/src/components/player/TauriLoader.ts`

把现有 VideoPlayer.tsx 内联的 `class TauriLoader` 原样搬出为独立模块：
- `getVideoFetchFn()` 改在 `doLoad()` 内部调用（每次加载拿最新注入的 fetch，避免 init 竞态）
- 保留 `load(context, config, callbacks)` / `abort()` / `destroy()` 三方法签名不变
- 保留 `response.data` 类型：m3u8 走 `string`，二进制走 `Uint8Array`
- 保留所有 `[TauriLoader]` 日志便于验证 CORS 绕过
- 不加 hls.js 的 `Loader<LoaderContext>` 类型约束（保持 `any`，避免 stats 字段不匹配）

### 3. 引入 Vidstack CSS

在 [main.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/main.tsx) 第 4 行 `import './index.css'` 之后新增：

```ts
import '@vidstack/react/player/layouts/default/styles.css';
```

### 4. 主题变量覆盖

在 [index.css](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/index.css) 末尾追加：

```css
:where(media-player) {
  --media-brand: var(--color-primary);
  --media-font-family: var(--font-family-sans);
}
```

DefaultVideoLayout 通过 `colorScheme="dark"` 自动适配深色，无需额外覆盖背景色。Vidstack 的 `--media-*` 变量与 Tailwind v4 `@theme` 的 `--color-*` 命名空间不冲突。

### 5. 重写 VideoPlayer.tsx

**props 接口保持不变**（PlayPage 零改动）：

```ts
interface VideoPlayerProps {
  sources: PlaySource[];
  initialSourceId?: string;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onSourceChange?: (source: PlaySource) => void;
  onSourceFail?: (sourceId: string) => void;
}
```

**核心结构**：

```tsx
import { MediaPlayer, MediaProvider, isHLSProvider } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import HLS from 'hls.js';
import { TauriLoader } from './TauriLoader';

const handleProviderChange = (provider) => {
  if (!isHLSProvider(provider)) return;
  provider.library = HLS;
  provider.config = {
    loader: TauriLoader,
    enableWorker: false,
    debug: true,
  };
};

<MediaPlayer
  src={currentSource.url}
  autoPlay
  onProviderChange={handleProviderChange}
  onHlsManifestLoaded={() => { setLoading(false); setError(null); }}
  onHlsError={(e) => { if (e.detail.fatal) handleSourceFail(); }}
  onError={() => handleSourceFail()}
  onTimeUpdate={(e) => onTimeUpdate?.(e.detail.currentTime, e.detail.duration || 0)}
  onEnded={() => onEnded?.()}
>
  <MediaProvider />
  <DefaultVideoLayout icons={defaultLayoutIcons} colorScheme="dark" />
</MediaPlayer>
```

**保留的逻辑**：
- 多播放源自动切换：`handleSourceFail` 逻辑不变（1.5 秒后 `setCurrentIndex(nextIndex)`），通过改变 `src` 触发 Vidstack 内部 `hls.loadSource(newUrl)`
- loading/error 覆盖层：原 UI 原样保留，`z-10` 叠在 MediaPlayer 之上
- 重试按钮：`handleRetry` 重置 `currentIndex=0`
- Ref 镜像：`currentIndexRef` / `activeSourcesRef` / `onSourceFailRef` / `onSourceChangeRef`，所有异步回调读 ref 避免闭包陷阱
- onSourceChange 通知：`useEffect([currentIndex, activeSources])` 触发

**简化项**：
- 移除 `failCount` state（PlayPage 侧的 `reportPlaySourceFail` 已持久化失败次数，state 计数仅用于触发重渲染，冗余）
- 移除 `cancelled` 标志（Vidstack 内部管理 hls 生命周期，src 切换时旧 hls 自动清理）

### 6. StrictMode 注意

[main.tsx](file:///Users/mengfeng/我的文档/源码/movie-app/apps/desktop/src/main.tsx) 用了 `React.StrictMode`，开发模式下 `onProviderChange` 可能调用两次。Vidstack 内部对 library/config 设置是幂等的，不会创建两个 hls 实例。`handleSourceFail` 用 ref + setTimeout，最坏情况是跳过一条线路——可接受。如需严格防御可加 `failInFlightRef` 守卫。

## 验证步骤

### 1. 类型检查

```bash
pnpm --filter @movie-app/desktop typecheck
```

重点关注：`HLSErrorEvent`/`MediaTimeEvent` 类型解析、`provider.config` 赋值（用 `as any` 绕过 hls.js Loader 类型）、`isHLSProvider` 类型守卫。

### 2. 运行桌面端

```bash
pnpm desktop:dev
```

### 3. 功能验证清单

打开一个有多个播放源的剧集（如电影"诺曼底72小时"），逐项验证：

1. **CORS 绕过**：Console 看到 `[TauriLoader] 开始加载` 日志，无 `access control checks` 报错，视频正常播放
2. **设置菜单**（核心目标）：右下角齿轮图标 → 弹出菜单包含播放速度（0.5x/1x/1.25x/1.5x/2x）、画质（HLS levels）、字幕；切换倍速立即生效
3. **进度条**：同时显示播放进度（实色）和预加载进度（浅色 buffer）
4. **时间显示**：控制栏左侧显示"当前时间 / 总时长"格式
5. **观看进度保存**：播放 10 秒以上返回再进入，从上次位置继续；播放到结尾触发最终保存
6. **多播放源自动切换**：某线路 fatal 错误 → 显示"线路 X 失败，正在尝试线路 X+1" → 1.5 秒后自动切换
7. **全屏与快捷键**：全屏按钮可用，空格暂停/播放，左右箭头快进/后退
8. **重试按钮**：所有线路失败后显示重试按钮，点击从线路 1 重新开始

## 风险与回退

- **`onHlsError` 事件名**：Vidstack 文档确认按 `Hls.Events.ERROR → onHlsError` 映射。若该 prop 不触发，降级方案：在 `handleProviderChange` 内 `provider.instance.on(Hls.Events.ERROR, ...)` 手动监听
- **`response.data` 类型**：当前用 `Uint8Array`（与可工作代码一致）。若出现 data format errors，切回直接传 `arrayBuffer`（1 行改动）
- **Tailwind preflight 冲突**：若 controls 错位，加 `:where(media-player, media-player *) { all: revert-layer; }` 隔离（通常不需要）
