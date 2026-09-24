import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, LayoutChangeEvent, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useActivityMonitor } from './ActivityMonitor';

// 安卓模拟器资源监控悬浮层（诊断用）：
// - 每 1s 从宿主 monitor.py（10.0.2.2:8756）拉取 /monitor.json 显示处理器/内存/帧率
// - 路由变化时 POST /page 上报当前页面，供 CSV 打页面标签
// - 按住面板任意位置拖动（松手记忆位置，下次启动恢复）；右上角 x 隐藏（仅本次启动）
// - 点击面板内容弹出「功能资源占用」明细：各页面/功能的处理器/内存均值（GET /funcs，5s 刷新）
const HOST_PORT = 8756;
const MONITOR_ROOT = `http://10.0.2.2:${HOST_PORT}`;
const POS_KEY = 'resource-overlay-pos';
const DEFAULT_POS = { top: 42, left: 10 };

const PAGE_NAMES: Record<string, string> = {
  Home: '首页',
  Search: '搜索',
  KeywordCollect: '关键词采集',
  Category: '分类',
  Subtype: '分类',
  Play: '播放',
  Detail: '详情',
  Settings: '设置',
  TaskList: '任务',
  Movie: '电影',
  TV: '电视剧',
  Variety: '综艺',
  Anime: '动漫',
  Documentary: '纪录',
  SourceManager: '视频源',
  AiSourceImport: 'AI 导入',
  CollectConfig: '采集配置',
  AppearanceSettings: '外观设置',
  UsagePreferences: '使用偏好',
  RecommendationSettings: '推荐设置',
  HelpCenter: '帮助中心',
  CollectGuide: '采集引导',
  VideoManagement: '视频管理',
  TestCollect: '采集测试',
  KidLock: '儿童锁',
};

interface Props {
  routeRef: { current: string };
}

interface Snapshot {
  cpu_pct?: number;
  rss_mb?: number;
  fps?: number;
  busy_pct?: number | null;
  storage_mb?: number | null;
  pss_mb?: number;
  heap_alloc_mb?: number;
  nheap_mb?: number;
  net_rx_kb?: number;
  net_tx_kb?: number;
  app_alive?: boolean;
  pid?: number | string | null;
  page?: string;
}

interface FuncRow {
  page: string;
  busy_pct: number | null;
  seconds: number;
}

export function ResourceOverlay({ routeRef }: Props) {
  const isIOS = Platform.OS === 'ios';
  // iOS：App 内自包含本地聚合（忙%+帧率）；Android：host monitor.py 采样
  const local = useActivityMonitor(routeRef);
  const [data, setData] = useState<Snapshot | null>(null);
  const [lastOk, setLastOk] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState(DEFAULT_POS);
  const [showDetail, setShowDetail] = useState(false);
  const [funcs, setFuncs] = useState<FuncRow[] | null>(null);
  const [since, setSince] = useState('');
  const lastRoute = useRef('');
  const posRef = useRef(DEFAULT_POS);
  const startPos = useRef(DEFAULT_POS);
  const boxSize = useRef({ width: 0, height: 0 });

  const clampPos = (top: number, left: number) => {
    const { width, height } = Dimensions.get('window');
    const maxLeft = Math.max(0, width - 4 - boxSize.current.width);
    const maxTop = Math.max(0, height - 4 - boxSize.current.height);
    return { top: Math.max(0, Math.min(maxTop, top)), left: Math.max(0, Math.min(maxLeft, left)) };
  };

  const persistPos = (p: { top: number; left: number }) => {
    AsyncStorage.setItem(POS_KEY, JSON.stringify(p)).catch(() => {});
  };

  // 点击（Pressable 短按）与拖动（位移阈值）区分：tap 不触发拖动，move 抢走拖动
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startPos.current = posRef.current;
      },
      onPanResponderMove: (_evt, g) => {
        const next = clampPos(startPos.current.top + g.dy, startPos.current.left + g.dx);
        posRef.current = next;
        setPos(next);
      },
      onPanResponderRelease: () => persistPos(posRef.current),
      onPanResponderTerminate: () => persistPos(posRef.current),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  const loadFuncs = useCallback(() => {
    fetch(`${MONITOR_ROOT}/funcs`)
      .then((resp) => resp.json())
      .then((j) => {
        setFuncs(Array.isArray(j?.funcs) ? j.funcs : []);
        setSince(j?.since || '');
      })
      .catch(() => setFuncs(null));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(POS_KEY)
      .then((v) => {
        if (!v) return;
        const p = JSON.parse(v);
        if (typeof p?.top === 'number' && typeof p?.left === 'number') {
          const restored = clampPos(p.top, p.left);
          posRef.current = restored;
          setPos(restored);
        }
      })
      .catch(() => {});
  }, []);

  const onBoxLayout = (e: LayoutChangeEvent) => {
    boxSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
  };

  useEffect(() => {
    const postRoute = (r: string) => {
      fetch(`${MONITOR_ROOT}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: r }),
      }).catch(() => {});
    };
    // 心跳上报：每秒无条件上报当前路由，避免 monitor 重启/首帧丢失后页面标签停滞
    const timer = setInterval(() => {
      const r = routeRef.current || 'Home';
      if (r && r !== lastRoute.current) {
        lastRoute.current = r;
      }
      postRoute(r);
      fetch(`${MONITOR_ROOT}/monitor.json`)
        .then((resp) => resp.json())
        .then((j: Snapshot) => {
          setData(j);
          setLastOk(Date.now());
        })
        .catch(() => {
          setLastOk((v) => v);
        });
    }, 1000);
    postRoute(routeRef.current || 'Home');
    return () => clearInterval(timer);
  }, [routeRef]);

  // 明细面板打开时轮询 /funcs
  useEffect(() => {
    if (!showDetail) return;
    loadFuncs();
    const t = setInterval(loadFuncs, 5000);
    return () => clearInterval(t);
  }, [showDetail, loadFuncs]);

  // JS 侧细粒度探针（功能级）：250ms 调度滞后累积 = 主线程被长任务占用的额外时间，按页面归因 -> 忙%
  const busyRef = useRef({ busyMs: 0, started: Date.now(), lastEmit: Date.now() });
  useEffect(() => {
    const s = busyRef.current;
    s.busyMs = 0;
    s.started = Date.now();
    s.lastEmit = Date.now();
    let expected = Date.now();
    const emit = () => {
      const r = routeRef.current || 'Home';
      const now = Date.now();
      const win = Math.max(1, now - s.started);
      fetch(`${MONITOR_ROOT}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: r,
          busy_ms: Math.round(s.busyMs),
          window_ms: Math.round(win),
        }),
      }).catch(() => {});
      s.busyMs = 0;
      s.started = now;
      s.lastEmit = now;
    };
    const timer = setInterval(() => {
      const now = Date.now();
      const lag = now - expected;
      expected = now + 250;
      if (lag > 260) s.busyMs += lag - 250;
      if (now - s.lastEmit >= 5000) emit();
    }, 250);
    return () => clearInterval(timer);
  }, [routeRef]);

  if (hidden) return null;
  const stale = Date.now() - lastOk > 6000;
  const cpu = isIOS ? 0 : (data?.cpu_pct ?? 0);
  const rss = isIOS ? 0 : (data?.rss_mb ?? 0);
  const fps = isIOS ? local.fps : (data?.fps ?? 0);
  const busy = isIOS ? local.totalBusyPct : (data?.busy_pct ?? null);
  const storage = isIOS ? local.storageMB : (data?.storage_mb ?? null);
  const displayFuncs = isIOS ? local.funcs : funcs;
  const displaySince = isIOS ? local.since : since;
  const sinceLabel = displaySince ? displaySince.replace('T', ' ').slice(5, 16) : '';

  return (
    <>
      <View style={[styles.box, { top: pos.top, left: pos.left }]} onLayout={onBoxLayout} {...pan.panHandlers}>
        <Pressable style={styles.close} onPress={() => setHidden(true)} hitSlop={8}>
          <Text style={styles.closeText}>×</Text>
        </Pressable>
        <Pressable style={styles.bodyBtn} onPress={() => setShowDetail(true)}>
          <Text style={styles.title} numberOfLines={1}>
            实时监控
          </Text>
          {isIOS ? (
            <>
              <Text style={styles.line}>
                <Text style={styles.k}>主线程忙 </Text>
                {busy != null ? `${busy.toFixed(1)}%` : '-'}
                <Text style={styles.sep}>  </Text>
                <Text style={styles.k}>帧率 </Text>
                {fps.toFixed(1)}
              </Text>
              <Text style={styles.line}>
                <Text style={styles.k}>存储 </Text>
                {storage != null ? `${(storage / 1024).toFixed(1)}G` : '-'}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.line}>
                <Text style={styles.k}>处理器 </Text>
                {cpu.toFixed(1)}%
                <Text style={styles.sep}>  </Text>
                <Text style={styles.k}>内存 </Text>
                {rss.toFixed(0)}M
              </Text>
              <Text style={styles.line}>
                <Text style={styles.k}>帧率 </Text>
                {fps.toFixed(1)}
                <Text style={styles.sep}>  </Text>
                <Text style={styles.k}>主线程忙 </Text>
                {busy != null ? `${busy.toFixed(1)}%` : '-'}
              </Text>
              {storage != null && (
                <Text style={styles.line}>
                  <Text style={styles.k}>存储 </Text>
                  {(storage / 1024).toFixed(1)}G
                </Text>
              )}
            </>
          )}
          {!isIOS && stale && <Text style={[styles.line, styles.warn]}>监控服务离线，请启动 monitor.py</Text>}
        </Pressable>
      </View>

      {showDetail && (
        <>
          <Pressable style={styles.backdrop} onPress={() => setShowDetail(false)} />
          <View style={styles.detailPanel}>
            <View style={styles.detailHead}>
              <Text style={styles.detailTitle}>功能资源占用</Text>
              <Pressable onPress={() => setShowDetail(false)} hitSlop={10}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            {sinceLabel ? (
              <Text style={styles.detailSince}>
                {isIOS
                  ? `统计自 ${sinceLabel} · 忙% = 该功能对总忙碌的贡献占比，之和恒 = 总主线程忙`
                  : `统计自 ${sinceLabel} · 处理器/内存 = App 全进程占用（分不清功能，只留总浮窗）。各页忙% = 该功能对总忙碌的贡献占比，之和恒 = 总浮窗主线程忙`}
              </Text>
            ) : null}
            <ScrollView style={styles.detailScroll} nestedScrollEnabled>
              {displayFuncs === null ? (
                <Text style={styles.empty}>监控服务离线，无法获取明细</Text>
              ) : displayFuncs.length === 0 ? (
                <Text style={styles.empty}>暂无数据，稍候自动刷新</Text>
              ) : (
                displayFuncs.map((f) => (
                  <View key={f.page} style={styles.funcRow}>
                    <Text style={styles.funcName} numberOfLines={1}>
                      {PAGE_NAMES[f.page] || f.page}
                    </Text>
                    <Text style={styles.funcVal}>
                      忙 {f.busy_pct != null ? `${f.busy_pct.toFixed(1)}%` : '-'}   停留 {f.seconds}s
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 30,
    backgroundColor: 'rgba(16,16,22,0.92)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 5,
    paddingRight: 20,
    minWidth: 132,
  },
  bodyBtn: {
    paddingHorizontal: 8,
  },
  title: {
    color: '#8fb3ff',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  line: {
    color: '#e8e8ee',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  k: {
    color: '#7f8794',
  },
  sep: {
    color: '#444',
  },
  warn: {
    color: '#ff9d5c',
    fontSize: 9,
  },
  close: {
    position: 'absolute',
    top: 1,
    right: 3,
    padding: 2,
  },
  closeText: {
    color: '#99a',
    fontSize: 14,
    lineHeight: 14,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 10000,
  },
  detailPanel: {
    position: 'absolute',
    top: 96,
    left: 16,
    right: 16,
    backgroundColor: '#131722',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    zIndex: 10001,
    elevation: 40,
  },
  detailHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  detailTitle: {
    color: '#e8e8ee',
    fontSize: 13,
    fontWeight: '700',
  },
  detailSince: {
    color: '#7f8794',
    fontSize: 9,
    marginBottom: 6,
  },
  detailScroll: {
    maxHeight: 300,
  },
  funcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  funcName: {
    color: '#8fb3ff',
    fontSize: 12,
    flexShrink: 1,
    marginRight: 8,
  },
  funcVal: {
    color: '#e8e8ee',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: '#7f8794',
    fontSize: 11,
    paddingVertical: 14,
    textAlign: 'center',
  },
});