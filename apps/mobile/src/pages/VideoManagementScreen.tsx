import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import BlurredBackground from '../components/BlurredBackground';
import type { ShortDramaConfig } from '@movie-app/core';

interface Props {
  navigation: any;
}

export default function VideoManagementScreen(_: Props) {
  const {
    deleteAllMedia, deleteMediaWithoutPlaySource, deleteMediaByGenres,
    getSubTypesByType, getHiddenMediaCount, hideMediaByGenres, unhideMediaByGenres,
    shortDramaConfig, loadShortDramaConfig, updateShortDramaConfig, getDefaultShortDramaConfig,
    batchReprobeMedia, reprobeMediaCount, loadReprobeMediaList,
    getFullReprobeMediaCount, startFullReprobeTask, loadRunningReprobeTask, runningReprobeTask,
    reprobeProgress,
  } = useAppStore();
  const colors = useThemeColors();

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

  const handleBatchReprobe = useCallback(async () => {
    Alert.alert('批量重新探测', '将对未判断或兜底状态的电视剧重新探测。确定继续？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', onPress: async () => {
        try {
          const result = await batchReprobeMedia();
          Alert.alert('完成', `共处理 ${result.total} 部\n短剧: ${result.shortDrama}  长剧: ${result.longDrama}  失败: ${result.failed}`);
        } catch (err: any) {
          Alert.alert('错误', err.message);
        }
      }},
    ]);
  }, [batchReprobeMedia]);

  const reprobeProgressPct = reprobeProgress && reprobeProgress.total > 0
    ? Math.round((reprobeProgress.processed / reprobeProgress.total) * 100)
    : 0;

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { padding: 20, paddingTop: 60 },
    title: { fontSize: 24, fontWeight: 'bold', color: colors.text },
    content: { paddingHorizontal: 15, gap: 12, paddingBottom: 30 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 12 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
    cardDesc: { fontSize: 13, color: colors.mutedForeground, lineHeight: 18 },
    text: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    warningText: { fontSize: 13, color: colors.error },
    dangerBtn: { paddingVertical: 14, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 8, alignItems: 'center' },
    btnDisabled: { opacity: 0.5 },
    dangerBtnText: { color: colors.error, fontSize: 15, fontWeight: '500' },
    primaryBtn: { paddingVertical: 14, backgroundColor: colors.primary, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
    primaryBtnText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '500' },
    outlineBtn: { paddingVertical: 10, backgroundColor: colors.card, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    outlineBtnText: { color: colors.textSecondary, fontSize: 14 },
    configSection: { gap: 8 },
    configLabel: { fontSize: 14, fontWeight: '500', color: colors.text },
    configDesc: { fontSize: 12, color: colors.mutedForeground, lineHeight: 16 },
    configInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
    configInputRow: { flexDirection: 'row', gap: 8 },
    configInputFlex: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text },
    addBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
    addBtnText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '500' },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    tagText: { fontSize: 12, color: colors.textSecondary },
    tagRemove: { fontSize: 12, color: colors.error, marginLeft: 4 },
    configActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    progressSection: { gap: 8 },
    progressBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
    progressText: { fontSize: 12, color: colors.mutedForeground, textAlign: 'center' },
    statsGrid: { flexDirection: 'row', gap: 8 },
    statBox: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: colors.surface, borderRadius: 8 },
    statNumber: { fontSize: 20, fontWeight: 'bold' },
    statLabel: { fontSize: 11, color: colors.mutedForeground, marginTop: 2 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: colors.surface, borderRadius: 8 },
    infoText: { fontSize: 13, color: colors.textSecondary, flex: 1 },
    infoBold: { fontWeight: '600', color: colors.text },
    resultBox: { padding: 12, backgroundColor: colors.surface, borderRadius: 8, gap: 6 },
    resultText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
    runningBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: colors.primaryLight, borderRadius: 8 },
    runningText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  }), [colors]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>视频管理</Text>
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
                    <TouchableOpacity key={i} style={styles.tag} onPress={() => removePattern(p)}>
                      <Text style={styles.tagText}>{p}<Text style={styles.tagRemove}> x</Text></Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.configInputRow}>
                  <TextInput
                    style={styles.configInputFlex}
                    value={patternInput}
                    onChangeText={setPatternInput}
                    placeholder="输入模板，如 {N}分钟"
                    placeholderTextColor={colors.disabledForeground}
                    onSubmitEditing={addPattern}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={addPattern}>
                    <Text style={styles.addBtnText}>添加</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.configSection}>
                <View style={styles.configInputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.configLabel}>短剧阈值（分钟）</Text>
                    <Text style={styles.configDesc}>低于此值判定为短剧</Text>
                    <TextInput
                      style={[styles.configInput, { marginTop: 6 }]}
                      keyboardType="number-pad"
                      value={String(localConfig.durationThresholdMinutes)}
                      onChangeText={(v) => setLocalConfig({ ...localConfig, durationThresholdMinutes: Math.max(1, parseInt(v) || 30) })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.configLabel}>探测集数上限</Text>
                    <Text style={styles.configDesc}>最多探测N集视频流</Text>
                    <TextInput
                      style={[styles.configInput, { marginTop: 6 }]}
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
                    <TouchableOpacity key={i} style={styles.tag} onPress={() => removeKeyword(kw)}>
                      <Text style={styles.tagText}>{kw}<Text style={styles.tagRemove}> x</Text></Text>
                    </TouchableOpacity>
                  ))}
                  {localConfig.metaKeywords.length > 30 && (
                    <Text style={[styles.configDesc, { alignSelf: 'center' }]}>...还有 {localConfig.metaKeywords.length - 30} 个</Text>
                  )}
                </View>
                <View style={styles.configInputRow}>
                  <TextInput
                    style={styles.configInputFlex}
                    value={keywordInput}
                    onChangeText={setKeywordInput}
                    placeholder="输入关键词后添加"
                    placeholderTextColor={colors.disabledForeground}
                    onSubmitEditing={addKeyword}
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={addKeyword}>
                    <Text style={styles.addBtnText}>添加</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.configActions}>
                <TouchableOpacity style={styles.outlineBtn} onPress={handleResetConfig}>
                  <Text style={styles.outlineBtnText}>恢复默认</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={handleSaveConfig}>
                  <Text style={styles.primaryBtnText}>{configSaved ? '已保存' : '保存配置'}</Text>
                </TouchableOpacity>
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
                  <Text style={[styles.statNumber, { color: colors.primary }]}>{reprobeProgress.longDrama}</Text>
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
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.runningText}>探测任务运行中...</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, (fullReprobing || fullReprobeMediaCount === 0 || !!runningReprobeTask) && styles.btnDisabled]}
            onPress={handleFullReprobe}
            disabled={fullReprobing || fullReprobeMediaCount === 0 || !!runningReprobeTask}
          >
            <Text style={styles.primaryBtnText}>
              {runningReprobeTask ? '任务运行中...' : fullReprobing ? '启动中...' : `开始全量重新探测 (${fullReprobeMediaCount})`}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>危险操作</Text>
          <Text style={styles.warningText}>以下操作不可恢复，请谨慎使用</Text>

          <TouchableOpacity
            style={[styles.dangerBtn, deletingAll && styles.btnDisabled]}
            onPress={handleDeleteAll}
            disabled={deletingAll}
          >
            {deletingAll ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.dangerBtnText}>删除所有视频</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerBtn, deletingOrphans && styles.btnDisabled]}
            onPress={handleDeleteOrphans}
            disabled={deletingOrphans}
          >
            {deletingOrphans ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.dangerBtnText}>删除无播放源视频</Text>
            )}
          </TouchableOpacity>
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
