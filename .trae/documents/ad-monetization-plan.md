# Movie App 广告变现方案

## 概述

项目为纯客户端视频流媒体 APP，视频源为爬取的第三方 CMS API。广告变现完全在客户端播放器层面实现（CSAI），无需控制视频源。

---

## 方案一：信息流广告（推荐先做，改动最小）

### 实现位置

- **首页**：`apps/desktop/src/pages/HomePage.tsx` — MediaGrid 卡片之间插入广告卡片
- **搜索页**：`apps/desktop/src/pages/SearchPage.tsx` — 搜索结果列表中插入广告卡片

### 实现方式

1. 创建广告卡片组件 `AdCard.tsx`，样式与 MediaCard 一致但内容为广告
2. 在 MediaGrid 中按比例（如每 5 个卡片插入 1 个广告）随机插入

### 广告素材

- 初始使用模拟数据（本地静态广告）
- 后续接入广告联盟 SDK 动态获取

### 技术要点

```typescript
// 伪代码：在媒体列表中插入广告
const items = mediaList.flatMap((item, index) => {
  if (index > 0 && index % 5 === 0) {
    return [renderAdCard(), item];
  }
  return [item];
});
```

---

## 方案二：播放前贴片广告

### 实现位置

- **桌面端**：`apps/desktop/src/components/player/VideoPlayer.tsx`
- **移动端**：`apps/mobile/src/pages/PlayScreen.tsx`

### 实现方式

在 VideoPlayer 组件中增加状态机：

```typescript
type PlayState = 'ad' | 'content';

// 播放流程：
// 1. 用户点击播放 → playState = 'ad'
// 2. 加载广告视频 → 播放广告
// 3. 广告播放完毕(onended) → playState = 'content'
// 4. 加载正片 → 继续播放
```

### 状态机设计

| 状态 | 视频源 | UI 显示 |
|------|--------|---------|
| `ad` | 广告 URL | 显示"广告中..."提示 + 倒计时跳过按钮 |
| `content` | 正片 URL | 正常播放器控制栏 |

### 跳过功能

- 广告播放 5 秒后显示"跳过广告"按钮
- 用户点击跳过直接切换到正片

---

## 方案三：中插广告（进阶）

### 实现方式

监听视频播放时间，到达预设时间点时暂停正片播放广告：

```typescript
// 监听 currentTime
videoElement.ontimeupdate = () => {
  const currentTime = videoElement.currentTime;
  // 每 10 分钟插入一次广告
  if (currentTime > 0 && Math.floor(currentTime / 600) > lastAdInterval) {
    lastAdInterval = Math.floor(currentTime / 600);
    pauseContent();
    playAd();
  }
};
```

### 插入策略

- 电影：每 10 分钟插入一次
- 电视剧/综艺：每集开头插入一次
- 动漫：每集开头插入一次

---

## 方案四：开屏广告

### 实现位置

- **桌面端**：`apps/desktop/src/App.tsx` — 初始化完成后显示开屏广告
- **移动端**：`apps/mobile/App.tsx`

### 实现方式

启动应用时显示全屏广告，倒计时结束后自动进入首页：

```typescript
// App.tsx 伪代码
const [showSplashAd, setShowSplashAd] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => {
    setShowSplashAd(false);
  }, 5000); // 5秒后自动跳过
  return () => clearTimeout(timer);
}, []);

if (showSplashAd) {
  return <SplashAd onSkip={() => setShowSplashAd(false)} />;
}
```

---

## 广告联盟接入（盈利关键）

### 国内平台

| 平台 | 优势 | SDK |
|------|------|-----|
| **穿山甲（字节跳动）** | 覆盖广、变现能力强 | `react-native-pangle-ad` |
| **优量汇（腾讯）** | 微信生态流量 | `react-native-tencent-ad` |
| **百青藤（百度）** | 搜索流量 | 需原生集成 |

### 海外平台

| 平台 | 优势 | SDK |
|------|------|-----|
| **AdMob（谷歌）** | 全球覆盖 | `react-native-admob` |
| **Unity Ads** | 游戏类广告 | `react-native-unity-ads` |

### 接入流程

1. 在各平台注册账号，创建广告位
2. 集成对应 SDK
3. 替换模拟广告数据为 SDK 返回的真实广告

---

## 落地路径建议

### Phase 1（1-2天）：基础广告位

- [ ] 创建 `AdCard.tsx` 组件（信息流广告卡片）
- [ ] 在首页 MediaGrid 中插入广告
- [ ] 在搜索页结果中插入广告
- [ ] 使用模拟数据测试展示效果

### Phase 2（2-3天）：贴片广告

- [ ] 在 VideoPlayer 中实现 `isPlayingAd` 状态机
- [ ] 实现播放前贴片广告逻辑
- [ ] 添加跳过广告按钮
- [ ] 在移动端 PlayScreen 同步实现

### Phase 3（3-5天）：广告联盟接入

- [ ] 注册穿山甲/优量汇账号
- [ ] 创建广告位获取 AppId/AdSlotId
- [ ] 集成广告 SDK
- [ ] 替换模拟数据为真实广告
- [ ] 测试广告展示和点击转化

### Phase 4（可选）：进阶功能

- [ ] 中插广告功能
- [ ] 开屏广告功能
- [ ] 广告效果统计
- [ ] 广告缓存优化

---

## 注意事项

### 合规要求

- 广告内容需符合法律法规
- 需提供"跳过广告"功能
- 广告时长不宜过长（建议 5-15 秒）

### 用户体验

- 广告频率不宜过高（建议每小时不超过 5 次）
- 广告内容应与影视内容相关
- 提供付费去广告选项（未来会员订阅功能）

### 技术优化

- 预加载广告视频以减少等待
- 支持广告缓存以提高加载速度
- 监控广告展示和点击数据
