import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useAppStore, getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import type { ShortDramaConfig } from '@movie-app/core';

interface Props {
  navigation: any;
}

export default function VideoManagementScreen({ navigation }: Props) {
  const {
    deleteAllMedia, deleteMediaWithoutPlaySource, deleteMediaByGenres,
    getSubTypesByType, getHiddenMediaCount, hideMediaByGenres, unhideMediaByGenres,
    shortDramaConfig, loadShortDramaConfig, updateShortDramaConfig, getDefaultShortDramaConfig,
    batchReprobeMedia, reprobeMediaCount, reprobeMediaList, loadReprobeMediaList,
    getFullReprobeMediaCount, startReprobeTask, startFullReprobeTask, cancelReprobeTask,
    loadRunningReprobeTask, runningReprobeTask, reprobeProgress,
  } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);

  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);

  const [localConfig, setLocalConfig] = useState<ShortDramaConfig | null>(null);
  const [configSaved, setConfigSaved] = useState(false);
  const [patternInput, setPatternInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [fullReprobeMediaCount, setFullReprobeMediaCount] = useState(0);
  const [fullReprobing, setFullReprobing] = useState(false);
  const [fullReprobeResult, setFullReprobeResult] = useState<{ total: number; shortDrama: number; longDrama: number; failed: number } | null>(null);

  const [reprobing, setReprobing] = useState(false);
  const [reprobeResult, setReprobeResult] = useState<{ total: number; shortDrama: number; longDrama: number; failed: number; failedItems: { id: string; title: string }[] } | null>(null);
  const [pollProgress, setPollProgress] = useState<{ total: number; processed: number; longDrama: number; shortDrama: number; failed: number; currentMediaTitle: string } | null>(null);

  useEffect(() => {
    getHiddenMediaCount().then(setHiddenCount).catch(() => {});
    loadShortDramaConfig();
    loadReprobeMediaList();
    loadRunningReprobeTask();
    getFullReprobeMediaCount().then(setFullReprobeMediaCount).catch(() => {});
  }, []);

  useEffect(() => {
    if (shortDramaConfig) {
      setLocalConfig({ ...shortDramaConfig });
    }
  }, [shortDramaConfig]);

  useEffect(() => {
    if (!fullReprobing || !runningReprobeTask) return;
    const interval = setInterval(() => {
      loadRunningReprobeTask();
    }, 2000);
    return () => clearInterval(interval);
  }, [fullReprobing, runningReprobeTask]);

  useEffect(() => {
    if (fullReprobing && !runningReprobeTask) {
      setFullReprobing(false);
    }
  }, [fullReprobing, runningReprobeTask]);

  const handleDeleteAll = () => {
    Alert.alert(
      '删除所有视频',
      '此操作将删除所有视频、剧集、播放源、收藏和观看历史，且不可恢复。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确认删除', style: 'destructive', onPress: async () => {
          setDeletingAll(true);
          try {
            await deleteAllMedia();
            Alert.alert('完成', '所有视频已删除');
          } catch (err: any) {
            Alert.alert('错误', err.message);
          } finally {
            setDeletingAll(false);
          }
        }},
      ],
    );
  };

  const handleDeleteOrphans = () => {
    Alert.alert(
      '删除无播放源视频',
      '将删除所有没有可用播放源的视频。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确认删除', style: 'destructive', onPress: async () => {
          setDeletingOrphans(true);
          try {
            const count = await deleteMediaWithoutPlaySource();
            Alert.alert('完成', `已删除 ${count} 个无播放源的视频`);
          } catch (err: any) {
            Alert.alert('错误', err.message);
          } finally {
            setDeletingOrphans(false);
          }
        }},
      ],
    );
  };

  const addPattern = useCallback(() => {
    const v = patternInput.trim();
    if (!v || !localConfig) return;
    if (localConfig.summaryPatterns.includes(v)) return;
    setLocalConfig({ ...localConfig, summaryPatterns: [...localConfig.summaryPatterns, v] });
    setPatternInput('');
  }, [patternInput, localConfig]);

  const removePattern = useCallback((pattern: string) => {
    if (!localConfig) return;
    setLocalConfig({ ...localConfig, summaryPatterns: localConfig.summaryPatterns.filter(p => p !== pattern) });
  }, [localConfig]);

  const addKeyword = useCallback(() => {
    const v = keywordInput.trim();
    if (!v || !localConfig) return;
    if (localConfig.metaKeywords.includes(v)) return;
    setLocalConfig({ ...localConfig, metaKeywords: [...localConfig.metaKeywords, v] });
    setKeywordInput('');
  }, [keywordInput, localConfig]);

  const removeKeyword = useCallback((kw: string) => {
    if (!localConfig) return;
    setLocalConfig({ ...localConfig, metaKeywords: localConfig.metaKeywords.filter(k => k !== kw) });
  }, [localConfig]);

  const handleSaveConfig = useCallback(async () => {
    if (!localConfig) return;
    try {
      await updateShortDramaConfig(localConfig);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (err: any) {
      Alert.alert('错误', err.message);
    }
  }, [localConfig, updateShortDramaConfig]);

  const handleResetConfig = useCallback(() => {
    const defaults = getDefaultShortDramaConfig();
    setLocalConfig(defaults);
  }, [getDefaultShortDramaConfig]);

  const handleFullReprobe = useCallback(async () => {
    Alert.alert('全量重新探测', '将清除所有电视剧的判断结果并重新探测。确定继续？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        setFullReprobing(true);
        setFullReprobeResult(null);
        try {
          await startFullReprobeTask();
        } catch (err: any) {
          Alert.alert('错误', err.message);
          setFullReprobing(false);
        }
      }},
    ]);
  }, [startFullReprobeTask]);

  const handleCancelReprobe = useCallback(async () => {
    if (!runningReprobeTask) return;
    Alert.alert('取消探测任务', '确定要取消正在运行的探测任务吗？', [
      { text: '否', style: 'cancel' },
      { text: '是', style: 'destructive', onPress: async () => {
        try {
          await cancelReprobeTask(runningReprobeTask.taskId);
          setReprobing(false);
          setPollProgress(null);
          loadReprobeMediaList();
        } catch (err: any) {
          Alert.alert('错误', err.message);
        }
      }},
    ]);
  }, [runningReprobeTask, cancelReprobeTask, loadReprobeMediaList]);

  const handleBatchReprobe = useCallback(async () => {
    if (reprobeMediaList.length === 0) return;
    Alert.alert('批量重新探测', '将对未判断或兜底状态的电视剧重新探测。确定继续？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        setReprobing(true);
        setReprobeResult(null);
        setPollProgress(null);
        try {
          const taskId = await startReprobeTask();
          pollTaskStatus(taskId);
        } catch (err: any) {
          Alert.alert('错误', err.message);
          setReprobing(false);
        }
      }},
    ]);
  }, [reprobeMediaList, startReprobeTask]);

  const pollTaskStatus = useCallback(async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const provider = getProvider();
        const task = await provider.selectOne<{ status: string; probed_count: number; short_drama_count: number; long_drama_count: number }>(
          "SELECT status, probed_count, short_drama_count, long_drama_count FROM collect_task WHERE task_id = ?",
          [taskId]
        );

        if (!task) {
          setReprobing(false);
          setPollProgress(null);
          return;
        }

        if (task.status === 'RUNNING' || task.status === 'PENDING') {
          setPollProgress({
            total: reprobeMediaList.length,
            processed: task.probed_count || 0,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            currentMediaTitle: '',
          });
          setTimeout(checkStatus, 2000);
        } else {
          setReprobing(false);
          setPollProgress(null);
          setReprobeResult({
            total: reprobeMediaList.length,
            longDrama: task.long_drama_count || 0,
            shortDrama: task.short_drama_count || 0,
            failed: (task.probed_count || 0) - (task.short_drama_count || 0) - (task.long_drama_count || 0),
            failedItems: [],
          });
          loadReprobeMediaList();
          loadRunningReprobeTask();
          if (task.status === 'COMPLETED') {
            Alert.alert('完成', '探测任务已完成');
          } else {
            Alert.alert('失败', '探测任务失败');
          }
        }
      } catch (err) {
        console.error('轮询任务状态失败:', err);
        setReprobing(false);
      }
    };

    checkStatus();
  }, [reprobeMediaList.length, loadReprobeMediaList, loadRunningReprobeTask]);

  const reprobeProgressPct = reprobeProgress && reprobeProgress.total > 0
    ? Math.round((reprobeProgress.processed / reprobeProgress.total) * 100)
    : 0;

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { paddingHorizontal: 15, gap: 12, paddingBottom: 30, paddingTop: 15 },
    card: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 16, gap: 12 },
    cardTitle: { fontSize: s(16), fontWeight: '600', color: colors.text },
    cardDesc: { fontSize: s(13), color: colors.mutedForeground, lineHeight: 18 },
    text: { fontSize: s(14), color: colors.textSecondary, lineHeight: 22 },
    warningText: { fontSize: s(13), color: colors.error },
    configSection: { gap: 8 },
    configLabel: { fontSize: s(14), fontWeight: '500', color: colors.text },
    configDesc: { fontSize: s(12), color: colors.mutedForeground, lineHeight: 16 },
    configInputRow: { flexDirection: 'row', gap: 8 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    configActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    progressSection: { gap: 8 },
    progressBar: { height: 6, backgroundColor: colors.trackBg, borderRadius: radius.progress, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.mutedForeground, borderRadius: radius.progress },
    progressText: { fontSize: s(12), color: colors.mutedForeground, textAlign: 'center' },
    statsGrid: { flexDirection: 'row', gap: 8 },
    statBox: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: surfaceBg, borderRadius: radius.md },
    statNumber: { fontSize: s(20), fontWeight: 'bold' },
    statLabel: { fontSize: s(11), color: colors.mutedForeground, marginTop: 2 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: surfaceBg, borderRadius: radius.md },
    infoText: { fontSize: s(13), color: colors.textSecondary, flex: 1 },
    infoBold: { fontWeight: '600', color: colors.text },
    resultBox: { padding: 12, backgroundColor: surfaceBg, borderRadius: radius.md, gap: 6 },
    resultText: { fontSize: s(13), color: colors.textSecondary, lineHeight: 18 },
    runningBadge: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: hexToRgba(colors.mutedForeground, 0.15), borderRadius: radius.md },
    runningBadgeCol: { flexDirection: 'column', padding: 10, backgroundColor: hexToRgba(colors.mutedForeground, 0.15), borderRadius: radius.md },
    runningText: { fontSize: s(13), color: colors.text, fontWeight: '500' },
  }), [colors, cardBg, surfaceBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>视频管理</Text>
          <View style={styles.placeholder} />
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>长短剧判断配置</Text>
          <Text style={styles.cardDesc}>配置三层判断逻辑的参数。修改配置后需重新探测才能生效。</Text>

          {localConfig && (
            <>
              <View style={styles.configSection}>
                <Text style={styles.configLabel}>第1层：从简介提取时长的匹配模板</Text>
                <Text style={styles.configDesc}>用 {'{N}'} 代表数字，例如「{'{N}'}分钟」可匹配"30分钟"</Text>
                <View style={styles.tagRow}>
                  {localConfig.summaryPatterns.map((p, i) => (
                    <Button key={i} variant="secondary" size="sm" onPress={() => removePattern(p)}>
                      {p} x
                    </Button>
                  ))}
                </View>
                <View style={styles.configInputRow}>
                  <Input
                    size="sm"
                    style={{ flex: 1 }}
                    value={patternInput}
                    onChangeText={setPatternInput}
                    placeholder="输入模板，如 {N}分钟"
                    onSubmitEditing={addPattern}
                    returnKeyType="done"
                  />
                  <Button variant="primary" size="sm" onPress={addPattern}>
                    添加
                  </Button>
                </View>
              </View>

              <View style={styles.configSection}>
                <View style={styles.configInputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.configLabel}>短剧阈值（分钟）</Text>
                    <Text style={styles.configDesc}>低于此值判定为短剧</Text>
                    <Input
                      size="sm"
                      style={{ marginTop: 6 }}
                      keyboardType="number-pad"
                      value={String(localConfig.durationThresholdMinutes)}
                      onChangeText={(v) => setLocalConfig({ ...localConfig, durationThresholdMinutes: Math.max(1, parseInt(v) || 30) })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.configLabel}>探测集数上限</Text>
                    <Text style={styles.configDesc}>最多探测N集视频流</Text>
                    <Input
                      size="sm"
                      style={{ marginTop: 6 }}
                      keyboardType="number-pad"
                      value={String(localConfig.probeEpisodeCount)}
                      onChangeText={(v) => setLocalConfig({ ...localConfig, probeEpisodeCount: Math.max(1, parseInt(v) || 8) })}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.configSection}>
                <Text style={styles.configLabel}>第3层：元数据关键词列表</Text>
                <Text style={styles.configDesc}>当第1、2层均未命中时，根据简介、标题、类型中的关键词判断</Text>
                <View style={styles.tagRow}>
                  {localConfig.metaKeywords.slice(0, 30).map((kw, i) => (
                    <Button key={i} variant="secondary" size="sm" onPress={() => removeKeyword(kw)}>
                      {kw} x
                    </Button>
                  ))}
                  {localConfig.metaKeywords.length > 30 && (
                    <Text style={[styles.configDesc, { alignSelf: 'center' }]}>...还有 {localConfig.metaKeywords.length - 30} 个</Text>
                  )}
                </View>
                <View style={styles.configInputRow}>
                  <Input
                    size="sm"
                    style={{ flex: 1 }}
                    value={keywordInput}
                    onChangeText={setKeywordInput}
                    placeholder="输入关键词后添加"
                    onSubmitEditing={addKeyword}
                    returnKeyType="done"
                  />
                  <Button variant="primary" size="sm" onPress={addKeyword}>
                    添加
                  </Button>
                </View>
              </View>

              <View style={styles.configActions}>
                <Button variant="secondary" size="sm" onPress={handleResetConfig}>
                  恢复默认
                </Button>
                <Button variant="primary" size="sm" style={{ flex: 1 }} onPress={handleSaveConfig}>
                  {configSaved ? '已保存' : '保存配置'}
                </Button>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>全量重新探测长短剧</Text>
          <Text style={styles.cardDesc}>
            清除所有电视剧的已有判断结果，全量重新执行三层判断逻辑。已有单集时长数据的将直接复用。
          </Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoText}>所有电视剧：<Text style={styles.infoBold}>{fullReprobeMediaCount} 部</Text></Text>
          </View>

          {fullReprobing && reprobeProgress && (
            <View style={styles.progressSection}>
              <Text style={styles.progressText}>正在探测：{reprobeProgress.currentMediaTitle || '准备中...'}</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${reprobeProgressPct}%` }]} />
              </View>
              <Text style={styles.progressText}>{reprobeProgress.processed}/{reprobeProgress.total} ({reprobeProgressPct}%)</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, { color: colors.text }]}>{reprobeProgress.processed}</Text>
                  <Text style={styles.statLabel}>已处理</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, { color: colors.success }]}>{reprobeProgress.shortDrama}</Text>
                  <Text style={styles.statLabel}>短剧</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, { color: colors.textSecondary }]}>{reprobeProgress.longDrama}</Text>
                  <Text style={styles.statLabel}>长剧</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statNumber, { color: colors.error }]}>{reprobeProgress.failed}</Text>
                  <Text style={styles.statLabel}>失败</Text>
                </View>
              </View>
            </View>
          )}

          {fullReprobeResult && !fullReprobing && (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                全量探测完成：共处理 {fullReprobeResult.total} 部{'\n'}
                短剧: {fullReprobeResult.shortDrama}  长剧: {fullReprobeResult.longDrama}  失败: {fullReprobeResult.failed}
              </Text>
            </View>
          )}

          {runningReprobeTask && !fullReprobing && (
            <View style={styles.runningBadge}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={styles.runningText}>探测任务运行中</Text>
              </View>
              <TouchableOpacity onPress={handleCancelReprobe}>
                <Text style={{ color: colors.error, fontSize: s(13), fontWeight: '500' }}>取消</Text>
              </TouchableOpacity>
            </View>
          )}

          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={fullReprobing}
            disabled={fullReprobing || fullReprobeMediaCount === 0 || !!runningReprobeTask}
            onPress={handleFullReprobe}
          >
            {fullReprobing ? '启动中...' : `开始全量重新探测 (${fullReprobeMediaCount})`}
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>批量重新探测长短剧</Text>
          <Text style={styles.cardDesc}>
            对所有经过三级降级判断后仍为兜底状态（FALLBACK）或未判断的电视剧进行重新探测。
            此操作将实际探测视频流时长，准确判断长短剧分类。任务在后台运行，可以跳转到其他页面。
          </Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoText}>待探测：<Text style={styles.infoBold}>{reprobeMediaList.length} 部电视剧</Text></Text>
          </View>

          {runningReprobeTask && (
            <View style={styles.runningBadgeCol}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                  <Text style={styles.runningText}>探测任务运行中</Text>
                </View>
                <TouchableOpacity onPress={handleCancelReprobe}>
                  <Text style={{ color: colors.error, fontSize: s(13), fontWeight: '500' }}>取消</Text>
                </TouchableOpacity>
              </View>

              {reprobing && pollProgress && (
                <View style={styles.progressSection}>
                  <Text style={styles.progressText}>正在探测：{pollProgress.currentMediaTitle || '准备中...'}</Text>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pollProgress.total > 0 ? (pollProgress.processed / pollProgress.total) * 100 : 0}%` }]} />
                  </View>
                  <Text style={styles.progressText}>{pollProgress.processed}/{pollProgress.total}</Text>
                  <View style={styles.statsGrid}>
                    <View style={styles.statBox}>
                      <Text style={[styles.statNumber, { color: colors.text }]}>{pollProgress.processed}</Text>
                      <Text style={styles.statLabel}>已处理</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statNumber, { color: colors.success }]}>{pollProgress.shortDrama}</Text>
                      <Text style={styles.statLabel}>短剧</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statNumber, { color: colors.textSecondary }]}>{pollProgress.longDrama}</Text>
                      <Text style={styles.statLabel}>长剧</Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={[styles.statNumber, { color: colors.error }]}>{pollProgress.failed}</Text>
                      <Text style={styles.statLabel}>失败</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          {reprobeMediaList.length > 0 && !reprobing && !runningReprobeTask && (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                待探测 {reprobeMediaList.length} 部电视剧
              </Text>
            </View>
          )}

          {reprobeResult && !reprobing && (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                探测完成：共处理 {reprobeResult.total} 部{'\n'}
                短剧: {reprobeResult.shortDrama}  长剧: {reprobeResult.longDrama}  失败: {reprobeResult.failed}
              </Text>
            </View>
          )}

          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={reprobing}
            disabled={reprobing || reprobeMediaList.length === 0 || !!runningReprobeTask}
            onPress={handleBatchReprobe}
          >
            {reprobing ? '启动中...' : `开始批量重新探测 (${reprobeMediaList.length})`}
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>危险操作</Text>
          <Text style={styles.warningText}>以下操作不可恢复，请谨慎使用</Text>

          <Button
            variant="destructive"
            size="md"
            fullWidth
            loading={deletingAll}
            disabled={deletingAll}
            onPress={handleDeleteAll}
          >
            删除所有视频
          </Button>

          <Button
            variant="destructive"
            size="md"
            fullWidth
            loading={deletingOrphans}
            disabled={deletingOrphans}
            onPress={handleDeleteOrphans}
          >
            删除无播放源视频
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>隐藏管理</Text>
          <Text style={styles.text}>当前已隐藏 {hiddenCount} 个子类型</Text>
          <Text style={styles.text}>隐藏管理功能在桌面端完整可用</Text>
        </View>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
