import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';
import { SourceImportService, AI_SOURCE_PROMPT, AI_SOURCE_IMPORT_SAMPLE } from '@movie-app/core';
import type { VideoSource, CollectTask, CollectPreviewItem, ImportSourceItem, ParsedImportSource } from '@movie-app/core';
import Toast, { showToast } from '../components/Toast';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Check, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react-native';

interface Props {
  navigation: any;
}

const RATE_BARS = [2, 4, 6, 8, 10];

function formatLogTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  } catch {
    return timestamp;
  }
}

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  } catch {
    return timestamp;
  }
}

export default function SourceManagerScreen({ navigation }: Props) {
  const {
    videoSources, loadVideoSources,
    toggleSourceEnabled, removeVideoSource, addVideoSource,
    updateSourceRateLimit,
    checkVideoSource, collectSourceLatest, collectSourceAll,
    collectTasks, loadRunningCollectTasks,
    collectionLogs, clearCollectionLogs,
    previewResults, previewLoading,
    searchKeywordPreview, saveSelectedPreviewItems, clearPreviewResults,
    batchImportSources, validateImportSources,
  } = useAppStore();

  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const surfaceElevatedBg = hexToRgba(colors.surfaceElevated, cardOpacity / 100);
  const sf = useScaledFontSize();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    scrollContainer: { flex: 1 },
    header: { padding: 20, paddingTop: 60 },
    title: { fontSize: sf(24), fontWeight: 'bold', color: colors.text },
    list: { paddingHorizontal: 15, gap: 12 },
    sourceCard: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 15 },
    sourceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    sourceMain: { flex: 1 },
    sourceName: { fontSize: sf(17), fontWeight: '600', color: colors.text, marginBottom: 4 },
    sourceCode: { fontSize: sf(12), color: colors.disabledForeground },
    sourceUrl: { fontSize: sf(13), color: colors.mutedForeground, marginBottom: 10 },
    rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    rateButton: { padding: 4 },
    rateButtonText: { color: colors.textSecondary, fontSize: sf(14) },
    rateBars: { flexDirection: 'row', gap: 3 },
    rateBar: { width: 8, height: 16, borderRadius: radius.progress },
    rateLabel: { fontSize: sf(14), color: colors.textSecondary, width: 24, textAlign: 'center' },
    healthLabel: { fontSize: sf(12), marginBottom: 4 },
    lastCollectText: { fontSize: sf(11), color: colors.disabledForeground, marginBottom: 10 },
    sourceFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    actions: { flexDirection: 'row', gap: 8 },
    actionButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
    actionButtonDisabled: { opacity: 0.4 },
    sourceActions: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12 },
    sourceActionBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.md, minHeight: 40 },
    progressContainer: { marginTop: 10 },
    progressBar: { height: 4, backgroundColor: colors.trackBg, borderRadius: radius.progress, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.mutedForeground, borderRadius: radius.progress },
    progressText: { fontSize: sf(11), color: colors.mutedForeground, marginTop: 4, textAlign: 'center' },
    addButton: { margin: 15, paddingVertical: 16, borderRadius: radius.lg },
    bottomActions: { flexDirection: 'row', gap: 10, marginHorizontal: 15, marginBottom: 30 },
    logToggle: { flex: 1, paddingVertical: 12, borderRadius: radius.md },
    keywordBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md },
    logPanel: { marginHorizontal: 15, marginBottom: 20, backgroundColor: surfaceElevatedBg, borderRadius: radius.md, padding: 12, maxHeight: 300 },
    logPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    logPanelTitle: { fontSize: sf(14), color: colors.mutedForeground, fontWeight: '500' },
    clearLogBtn: { fontSize: sf(13), color: colors.textSecondary },
    logEmpty: { color: colors.disabledForeground, fontSize: sf(13), textAlign: 'center', paddingVertical: 20 },
    logItem: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
    logTime: { fontSize: sf(11), color: colors.disabledForeground, marginRight: 4, fontFamily: 'monospace' },
    logLevel: { fontSize: sf(11), fontWeight: 'bold', marginRight: 4, fontFamily: 'monospace' },
    logLevelError: { color: colors.error },
    logLevelWarn: { color: colors.warning },
    logLevelInfo: { color: colors.textSecondary },
    logSource: { fontSize: sf(11), color: colors.mutedForeground, marginRight: 4 },
    logMessage: { fontSize: sf(11), color: colors.textSecondary, flex: 1 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalContent: { width: '100%', backgroundColor: cardBg, borderRadius: radius.xl, padding: 24, gap: 16 },
    modalTitle: { fontSize: sf(20), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    inputRow: { flexDirection: 'row', gap: 12 },
    modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
    modalButton: { flex: 1 },
    keywordModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', paddingTop: 60 },
    keywordModalContent: { flex: 1, backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 12 },
    keywordSearchRow: { flexDirection: 'row', gap: 8 },
    optionRow: { flexDirection: 'row', gap: 16 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    switchLabel: { fontSize: sf(13), color: colors.mutedForeground },
    previewLoading: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 30, gap: 8 },
    previewLoadingText: { color: colors.mutedForeground, fontSize: sf(14) },
    previewEmpty: { color: colors.disabledForeground, textAlign: 'center', paddingVertical: 30, fontSize: sf(15) },
    previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    selectedCount: { color: colors.mutedForeground, fontSize: sf(13) },
    previewList: { maxHeight: 400 },
    previewItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.sm },
    previewItemSelected: { backgroundColor: 'rgba(74,158,255,0.05)' },
    previewCheckbox: { width: 22, height: 22, borderRadius: radius.sm, backgroundColor: colors.surface, marginRight: 12, justifyContent: 'center', alignItems: 'center' },
    previewItemInfo: { flex: 1 },
    previewItemTitle: { fontSize: sf(15), color: colors.text, marginBottom: 2 },
    previewItemMeta: { fontSize: sf(12), color: colors.mutedForeground, marginBottom: 1 },
    previewItemDetail: { fontSize: sf(11), color: colors.disabledForeground },
    aiModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', paddingTop: 60 },
    aiModalContent: { flex: 1, backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 12 },
    aiSubtitle: { fontSize: sf(13), color: colors.mutedForeground, textAlign: 'center', lineHeight: 18 },
    aiPromptScroll: { flex: 1, backgroundColor: surfaceElevatedBg, borderRadius: radius.md, padding: 12 },
    aiPromptText: { fontSize: sf(12), color: colors.textSecondary, lineHeight: 18 },
    aiTextarea: { flex: 1, backgroundColor: surfaceElevatedBg, color: colors.textSecondary, borderRadius: radius.md, padding: 12, fontSize: sf(13), fontFamily: 'monospace', textAlignVertical: 'top', minHeight: 200 },
    aiSampleRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    aiPreviewList: { flex: 1 },
    aiPreviewItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: radius.md, marginBottom: 8, backgroundColor: cardBg },
    aiPreviewItemValid: { backgroundColor: 'rgba(34, 197, 94, 0.05)' },
    aiPreviewItemWarn: { backgroundColor: 'rgba(234, 179, 8, 0.15)' },
    aiPreviewItemError: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
    aiPreviewIcon: { alignItems: 'center', justifyContent: 'center' },
    aiPreviewInfo: { flex: 1 },
    aiPreviewName: { fontSize: sf(14), color: colors.text },
    aiPreviewCode: { fontSize: sf(12), color: colors.mutedForeground },
    aiPreviewUrl: { fontSize: sf(11), color: colors.disabledForeground, marginTop: 2 },
    aiPreviewError: { fontSize: sf(11), color: colors.error, marginTop: 2 },
    aiPreviewWarn: { fontSize: sf(11), color: colors.warning, marginTop: 2 },
    aiResultContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 8 },
    aiResultText: { fontSize: sf(18), color: colors.success, fontWeight: '600' },
    aiResultSubtext: { fontSize: sf(14), color: colors.mutedForeground },
  }), [colors, cardBg, surfaceBg, surfaceElevatedBg, sf]);

  const getBarColor = (level: number, threshold: number): string => {
    if (level >= threshold) return colors.success;
    if (level >= threshold - 1) return colors.warning;
    return colors.disabledForeground;
  };

  const getHealthLabel = (source: VideoSource): { label: string; color: string } => {
    const failCount = source.failCount || 0;
    const totalRequests = source.totalRequests || 0;
    const status = source.healthStatus;
    const failRate = totalRequests > 0 ? (failCount / totalRequests) * 100 : 0;

    if (status === 'DOWN' || status === 'unhealthy') {
      return { label: '源不可用，建议降速', color: colors.error };
    }
    if (failRate > 20) {
      return { label: '失败较多，建议降速', color: colors.error };
    }
    if (status === 'DEGRADED' || status === 'degraded' || failRate > 10) {
      return { label: '状态不稳定，建议降速', color: colors.warning };
    }
    if (failRate < 5 && (source.rateLimit || 0) < 5) {
      return { label: '状态良好，可以加速', color: colors.success };
    }
    return { label: '状态稳定，保持速率', color: colors.success };
  };

  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', baseUrl: '', rateLimit: '5' });

  const [checkingSource, setCheckingSource] = useState<string | null>(null);
  const [showLogPanel, setShowLogPanel] = useState(false);

  const [keywordModalVisible, setKeywordModalVisible] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [relaxBlacklist, setRelaxBlacklist] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);

  const [aiModalVisible, setAiModalVisible] = useState(false);
  const [aiStep, setAiStep] = useState<'prompt' | 'paste' | 'preview'>('prompt');
  const [aiPastedText, setAiPastedText] = useState('');
  const [aiPreview, setAiPreview] = useState<ParsedImportSource[]>([]);
  const [aiImporting, setAiImporting] = useState(false);
  const [aiResult, setAiResult] = useState<{ imported: number; skipped: number } | null>(null);

  const hasRunningTaskRef = useRef(false);

  useEffect(() => {
    loadVideoSources();
    loadRunningCollectTasks();
  }, []);

  useEffect(() => {
    hasRunningTaskRef.current = collectTasks.some(
      (t: CollectTask) => t.status === 'PENDING' || t.status === 'RUNNING'
    );
  }, [collectTasks]);

  useEffect(() => {
    const interval = setInterval(async () => {
      await loadRunningCollectTasks();
      if (hasRunningTaskRef.current) {
        await loadVideoSources();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadRunningCollectTasks, loadVideoSources]);

  const isSourceCollecting = (sourceCode: string) => {
    return collectTasks.some(
      (t: CollectTask) => t.sourceCode === sourceCode && (t.status === 'PENDING' || t.status === 'RUNNING')
    );
  };

  const getRunningTaskForSource = (sourceCode: string): CollectTask | null => {
    return collectTasks.find(
      (t: CollectTask) => t.sourceCode === sourceCode && (t.status === 'PENDING' || t.status === 'RUNNING')
    ) || null;
  };

  const getProgress = (sourceCode: string) => {
    const task = getRunningTaskForSource(sourceCode);
    if (!task || task.totalPages === 0) return 0;
    return Math.round((task.currentPage / task.totalPages) * 100);
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('删除视频源', `确定要删除「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeVideoSource(id) },
    ]);
  };

  const handleAdjustRate = async (source: VideoSource, delta: number) => {
    const newRate = Math.max(1, Math.min(10, source.rateLimit + delta));
    await updateSourceRateLimit(source.id, newRate);
  };

  const handleAdd = () => {
    const code = form.code.trim();
    if (!code || !form.name.trim() || !form.baseUrl.trim()) {
      Alert.alert('提示', '请填写完整信息');
      return;
    }
    const source: VideoSource = {
      id: `source_${code}`,
      code,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      type: 'CMS',
      isEnabled: true,
      rateLimit: Number(form.rateLimit) || 5,
      healthStatus: null,
      lastCheckAt: null,
    };
    addVideoSource(source);
    setForm({ code: '', name: '', baseUrl: '', rateLimit: '5' });
    setModalVisible(false);
  };

  const handleCheck = async (source: VideoSource) => {
    if (checkingSource === source.code) return;
    setCheckingSource(source.code);
    try {
      const result = await checkVideoSource(source.id);
      if (result.healthy) {
        showToast(`「${source.name}」连接正常，响应时间: ${result.responseTime}ms`, 'success');
      } else {
        showToast(`「${source.name}」连接失败`, 'error');
      }
    } catch (err: any) {
      showToast(`「${source.name}」${err.message || '无法连接'}`, 'error');
    } finally {
      setCheckingSource(null);
    }
  };

  const handleCollect = async (sourceCode: string, type: 'increment' | 'full', sourceName: string) => {
    const label = type === 'increment' ? '增量' : '全量';
    try {
      const fn = type === 'increment' ? collectSourceLatest : collectSourceAll;
      const result = await fn(sourceCode);
      if (!result.success) {
        showToast(`${sourceName}${label}采集失败: ${result.error || '未知错误'}`, 'error');
      } else {
        await loadVideoSources();
        showToast(`${sourceName}${label}采集任务已完成`, 'success');
      }
    } catch (err: any) {
      showToast(`${sourceName}${label}采集失败: ${err.message || '未知错误'}`, 'error');
    }
  };

  const handleKeywordSearch = async () => {
    if (!keywordInput.trim()) return;
    setHasSearched(true);
    setSelectedPreviewIds(new Set());
    try {
      await searchKeywordPreview(keywordInput.trim(), {
        ignoreBlacklist: relaxBlacklist,
        unlimitedYear: relaxYear,
      });
    } catch (err) {
      console.error('关键词搜索采集失败:', err);
    }
  };

  const handleTogglePreviewItem = (fingerprint: string) => {
    setSelectedPreviewIds(prev => {
      const next = new Set(prev);
      if (next.has(fingerprint)) {
        next.delete(fingerprint);
      } else {
        next.add(fingerprint);
      }
      return next;
    });
  };

  const handleSelectAllPreview = () => {
    if (selectedPreviewIds.size === previewResults.length) {
      setSelectedPreviewIds(new Set());
    } else {
      setSelectedPreviewIds(new Set(previewResults.map(r => r.fingerprint)));
    }
  };

  const handleSavePreview = async () => {
    if (selectedPreviewIds.size === 0) {
      showToast('请先选择要保存的视频', 'info');
      return;
    }
    const selectedItems = previewResults.filter(r => selectedPreviewIds.has(r.fingerprint));
    setIsSaving(true);
    try {
      const count = await saveSelectedPreviewItems(selectedItems, {
        ignoreBlacklist: relaxBlacklist,
        unlimitedYear: relaxYear,
      });
      showToast(`已保存 ${count} 条视频`, 'success');
      clearPreviewResults();
      setKeywordModalVisible(false);
      setHasSearched(false);
      setKeywordInput('');
    } catch (err: any) {
      showToast(`保存失败: ${err.message || '未知错误'}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAiParse = async () => {
    if (!aiPastedText.trim()) {
      showToast('请先粘贴 AI 返回的数据', 'info');
      return;
    }
    const parsed = SourceImportService.parseJson(aiPastedText.trim());
    if (parsed.errors.length > 0) {
      showToast(parsed.errors[0].message, 'error');
      return;
    }
    if (parsed.items.length === 0) {
      showToast('未解析到有效数据', 'info');
      return;
    }
    const preview = await validateImportSources(parsed.items);
    setAiPreview(preview);
    setAiStep('preview');
  };

  const handleAiImport = async () => {
    const validItems = aiPreview
      .filter((p) => p.status === 'valid')
      .map((p) => p.item);
    if (validItems.length === 0) {
      showToast('没有可导入的有效视频源', 'info');
      return;
    }
    setAiImporting(true);
    try {
      const result = await batchImportSources(validItems);
      setAiResult({ imported: result.imported, skipped: result.skipped });
      if (result.imported > 0) {
        showToast(`成功导入 ${result.imported} 个视频源` + (result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''), 'success');
      } else {
        showToast(`${result.skipped} 个被跳过`, 'error');
      }
    } catch (err: any) {
      showToast(`导入失败: ${err.message || '未知错误'}`, 'error');
    } finally {
      setAiImporting(false);
    }
  };

  const handleAiReset = () => {
    setAiStep('prompt');
    setAiPastedText('');
    setAiPreview([]);
    setAiResult(null);
  };

  const handleCloseKeywordModal = () => {
    clearPreviewResults();
    setKeywordModalVisible(false);
    setHasSearched(false);
    setKeywordInput('');
  };

  return (
    <BlurredBackground imageUrl={null}>
    <View style={styles.container}>
      <Toast />
      <ScrollView style={styles.scrollContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>视频源管理</Text>
        </View>

        <View style={styles.list}>
          {videoSources.map((source: VideoSource, index: number) => {
            const health = getHealthLabel(source);
            const collecting = isSourceCollecting(source.code);
            const progress = getProgress(source.code);
            const checking = checkingSource === source.code;

            return (
              <View key={source.id} style={styles.sourceCard}>
                <View style={styles.sourceHeader}>
                  <View style={styles.sourceMain}>
                    <Text style={styles.sourceName}>{source.name}</Text>
                    <Text style={styles.sourceCode}>{source.code}</Text>
                  </View>
                  <Switch
                    value={source.isEnabled}
                    onValueChange={(value) => toggleSourceEnabled(source.id, value)}
                    trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                    thumbColor={source.isEnabled ? colors.swiftThumb : colors.disabledForeground}
                  />
                </View>
                <Text style={styles.sourceUrl}>{source.baseUrl}</Text>

                <View style={styles.rateRow}>
                  <Button
                    variant="icon"
                    size="sm"
                    style={styles.rateButton}
                    onPress={() => handleAdjustRate(source, -1)}
                  >
                    <Text style={styles.rateButtonText}>▼</Text>
                  </Button>
                  <View style={styles.rateBars}>
                    {RATE_BARS.map((threshold, idx) => (
                      <View
                        key={idx}
                        style={[styles.rateBar, { backgroundColor: getBarColor(source.rateLimit, threshold) }]}
                      />
                    ))}
                  </View>
                  <Text style={styles.rateLabel}>{source.rateLimit}</Text>
                  <Button
                    variant="icon"
                    size="sm"
                    style={styles.rateButton}
                    onPress={() => handleAdjustRate(source, 1)}
                  >
                    <Text style={styles.rateButtonText}>▲</Text>
                  </Button>
                </View>

                <Text style={[styles.healthLabel, { color: health.color }]}>{health.label}</Text>

                <Text style={styles.lastCollectText}>
                  上次采集: {source.lastCollectedAt ? formatTime(source.lastCollectedAt) : '从未'}
                </Text>

                <View style={styles.sourceFooter}>
                  <View style={styles.actions}>
                    <Button
                      variant="destructive"
                      size="sm"
                      style={styles.actionButton}
                      onPress={() => handleDelete(source.id, source.name)}
                    >
                      删除
                    </Button>
                  </View>
                </View>

                <View style={styles.sourceActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    style={styles.sourceActionBtn}
                    loading={checking}
                    disabled={checking}
                    onPress={() => handleCheck(source)}
                  >
                    检测
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    style={styles.sourceActionBtn}
                    disabled={collecting}
                    onPress={() => handleCollect(source.code, 'increment', source.name)}
                  >
                    增量采集
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    style={styles.sourceActionBtn}
                    disabled={collecting}
                    onPress={() => handleCollect(source.code, 'full', source.name)}
                  >
                    全量采集
                  </Button>
                </View>

                {collecting && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.progressText}>采集中... {progress}%</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Button variant="primary" size="lg" fullWidth style={styles.addButton} onPress={() => setModalVisible(true)}>
          手动添加
        </Button>

        <Button
          variant="primary"
          size="lg"
          fullWidth
          style={StyleSheet.flatten([styles.addButton, { marginTop: 0 }])}
          onPress={() => {
            setAiModalVisible(true);
            handleAiReset();
          }}
        >
          AI 导入
        </Button>

        <View style={styles.bottomActions}>
          <Button variant="secondary" size="sm" style={styles.logToggle} onPress={() => setShowLogPanel(p => !p)}>
            {showLogPanel ? '收起采集日志' : `查看采集日志 (${collectionLogs.length})`}
          </Button>
          <Button variant="secondary" size="sm" style={styles.keywordBtn} onPress={() => setKeywordModalVisible(true)}>
            关键词搜索采集
          </Button>
        </View>

        {showLogPanel && (
          <View style={styles.logPanel}>
            <View style={styles.logPanelHeader}>
              <Text style={styles.logPanelTitle}>采集日志</Text>
              <Button variant="link" size="sm" onPress={clearCollectionLogs}>
                清空
              </Button>
            </View>
            {collectionLogs.length === 0 ? (
              <Text style={styles.logEmpty}>暂无日志</Text>
            ) : (
              [...collectionLogs].reverse().map((log, idx) => (
                <View key={idx} style={styles.logItem}>
                  <Text style={styles.logTime}>{formatLogTime(log.timestamp)}</Text>
                  <Text style={[
                    styles.logLevel,
                    log.level === 'error' ? styles.logLevelError :
                    log.level === 'warn' ? styles.logLevelWarn :
                    styles.logLevelInfo,
                  ]}>
                    [{log.level.toUpperCase()}]
                  </Text>
                  {log.sourceName && <Text style={styles.logSource}>[{log.sourceName}]</Text>}
                  <Text style={styles.logMessage} numberOfLines={2}>{log.message}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>添加视频源</Text>
            <Input
              size="lg"
              placeholder="编码（唯一标识）"
              value={form.code}
              onChangeText={(text) => setForm({ ...form, code: text })}
            />
            <Input
              size="lg"
              placeholder="名称"
              value={form.name}
              onChangeText={(text) => setForm({ ...form, name: text })}
            />
            <Input
              size="lg"
              placeholder="API 地址"
              value={form.baseUrl}
              onChangeText={(text) => setForm({ ...form, baseUrl: text })}
            />
            <View style={styles.inputRow}>
              <Input
                size="lg"
                style={{ flex: 1 }}
                placeholder="速率限制"
                keyboardType="numeric"
                value={form.rateLimit}
                onChangeText={(text) => setForm({ ...form, rateLimit: text })}
              />
            </View>
            <View style={styles.modalButtons}>
              <Button variant="secondary" size="md" style={styles.modalButton} onPress={() => setModalVisible(false)}>
                取消
              </Button>
              <Button variant="primary" size="md" style={styles.modalButton} onPress={handleAdd}>
                添加
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={keywordModalVisible}
        onRequestClose={handleCloseKeywordModal}
      >
        <View style={styles.keywordModalOverlay}>
          <View style={styles.keywordModalContent}>
            <Text style={styles.modalTitle}>关键词搜索采集</Text>

            <View style={styles.keywordSearchRow}>
              <Input
                size="lg"
                style={{ flex: 1 }}
                placeholder="输入关键词..."
                value={keywordInput}
                onChangeText={setKeywordInput}
                onSubmitEditing={handleKeywordSearch}
                returnKeyType="search"
              />
              <Button variant="primary" size="sm" onPress={handleKeywordSearch}>
                搜索
              </Button>
            </View>

            <View style={styles.optionRow}>
              <View style={styles.switchRow}>
                <Switch
                  value={relaxBlacklist}
                  onValueChange={setRelaxBlacklist}
                  trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                  thumbColor={relaxBlacklist ? colors.swiftThumb : colors.disabledForeground}
                />
                <Text style={styles.switchLabel}>忽略黑名单</Text>
              </View>
              <View style={styles.switchRow}>
                <Switch
                  value={relaxYear}
                  onValueChange={setRelaxYear}
                  trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                  thumbColor={relaxYear ? colors.swiftThumb : colors.disabledForeground}
                />
                <Text style={styles.switchLabel}>不限年份</Text>
              </View>
            </View>

            {previewLoading && (
              <View style={styles.previewLoading}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={styles.previewLoadingText}>搜索中...</Text>
              </View>
            )}

            {hasSearched && !previewLoading && previewResults.length === 0 && (
              <Text style={styles.previewEmpty}>未找到相关结果</Text>
            )}

            {previewResults.length > 0 && (
              <>
                <View style={styles.previewHeader}>
                  <Button variant="link" size="sm" onPress={handleSelectAllPreview}>
                    {selectedPreviewIds.size === previewResults.length ? '取消全选' : `全选 (${previewResults.length})`}
                  </Button>
                  <Text style={styles.selectedCount}>已选 {selectedPreviewIds.size} 项</Text>
                </View>
                <ScrollView style={styles.previewList}>
                  {previewResults.map((item: CollectPreviewItem) => {
                    const selected = selectedPreviewIds.has(item.fingerprint);
                    return (
                      <TouchableOpacity
                        key={item.fingerprint}
                        style={[styles.previewItem, selected && styles.previewItemSelected]}
                        onPress={() => handleTogglePreviewItem(item.fingerprint)}
                      >
                        <View style={styles.previewCheckbox}>
                          {selected && <Check size={14} color={colors.text} />}
                        </View>
                        <View style={styles.previewItemInfo}>
                          <Text style={styles.previewItemTitle} numberOfLines={1}>
                            {item.title} ({item.year})
                          </Text>
                          <Text style={styles.previewItemMeta} numberOfLines={1}>
                            {item.type} · {item.area} · {item.sourceName}
                          </Text>
                          {item.directors.length > 0 && (
                            <Text style={styles.previewItemDetail} numberOfLines={1}>
                              导演: {item.directors.join(', ')}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <View style={styles.modalButtons}>
              <Button variant="secondary" size="md" style={styles.modalButton} onPress={handleCloseKeywordModal}>
                取消
              </Button>
              <Button
                variant="primary"
                size="md"
                style={styles.modalButton}
                loading={isSaving}
                disabled={isSaving}
                onPress={handleSavePreview}
              >
                保存选中 ({selectedPreviewIds.size})
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI 导入 Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={aiModalVisible}
        onRequestClose={() => {
          setAiModalVisible(false);
          handleAiReset();
        }}
      >
        <View style={styles.aiModalOverlay}>
          <View style={styles.aiModalContent}>
            {aiStep === 'prompt' && (
              <>
                <Text style={styles.modalTitle}>AI 导入视频源</Text>
                <Text style={styles.aiSubtitle}>
                  复制下方提示词，发给 AI 助手（如 ChatGPT、Claude 等），再将 AI 返回的结果粘贴到下一步
                </Text>
                <ScrollView style={styles.aiPromptScroll}>
                  <Text style={styles.aiPromptText} selectable>
                    {AI_SOURCE_PROMPT}
                  </Text>
                </ScrollView>
                <View style={styles.modalButtons}>
                  <Button
                    variant="secondary"
                    size="md"
                    style={styles.modalButton}
                    onPress={() => { setAiModalVisible(false); handleAiReset(); }}
                  >
                    取消
                  </Button>
                  <Button variant="primary" size="md" style={styles.modalButton} onPress={() => setAiStep('paste')}>
                    下一步
                  </Button>
                </View>
              </>
            )}

            {aiStep === 'paste' && (
              <>
                <Text style={styles.modalTitle}>粘贴 AI 返回的数据</Text>
                <Text style={styles.aiSubtitle}>
                  将 AI 返回的 JSON 数据粘贴到下方输入框中，然后点击解析
                </Text>
                <TextInput
                  style={styles.aiTextarea}
                  multiline
                  placeholder="在此粘贴 AI 返回的 JSON 数据..."
                  placeholderTextColor={colors.disabledForeground}
                  value={aiPastedText}
                  onChangeText={setAiPastedText}
                  textAlignVertical="top"
                />
                <View style={styles.aiSampleRow}>
                  <Button variant="link" size="sm" onPress={() => setAiPastedText(AI_SOURCE_IMPORT_SAMPLE)}>
                    填入示例
                  </Button>
                </View>
                <View style={styles.modalButtons}>
                  <Button
                    variant="secondary"
                    size="md"
                    style={styles.modalButton}
                    onPress={() => setAiStep('prompt')}
                  >
                    返回
                  </Button>
                  <Button variant="primary" size="md" style={styles.modalButton} onPress={handleAiParse}>
                    解析并预览
                  </Button>
                </View>
              </>
            )}

            {aiStep === 'preview' && (
              <>
                <Text style={styles.modalTitle}>预览导入结果</Text>
                <Text style={styles.aiSubtitle}>
                  {aiResult
                    ? `导入完成：成功 ${aiResult.imported} 个${aiResult.skipped > 0 ? `，跳过 ${aiResult.skipped} 个` : ''}`
                    : `共解析 ${aiPreview.length} 个视频源，${aiPreview.filter(p => p.status === 'valid').length} 个可导入`
                  }
                </Text>
                <ScrollView style={styles.aiPreviewList}>
                  {aiResult ? (
                    <View style={styles.aiResultContainer}>
                      <CheckCircle2 size={36} color="#22c55e" />
                      <Text style={styles.aiResultText}>成功导入 {aiResult.imported} 个视频源</Text>
                      {aiResult.skipped > 0 && (
                        <Text style={styles.aiResultSubtext}>{aiResult.skipped} 个被跳过</Text>
                      )}
                    </View>
                  ) : (
                    aiPreview.map((p, idx) => {
                      const isOverwrite = p.status === 'code_exists' || p.status === 'url_exists';
                      const statusIcon = p.status === 'valid' ? <CheckCircle2 size={14} color="#22c55e" /> : p.status === 'invalid_field' ? <XCircle size={14} color="#ef4444" /> : <AlertTriangle size={14} color="#eab308" />;
                      return (
                        <View
                          key={idx}
                          style={[
                            styles.aiPreviewItem,
                            p.status === 'valid' && styles.aiPreviewItemValid,
                            isOverwrite && styles.aiPreviewItemWarn,
                            p.status === 'invalid_field' && styles.aiPreviewItemError,
                            p.status === 'duplicate_in_list' && styles.aiPreviewItemWarn,
                          ]}
                        >
                          <View style={styles.aiPreviewIcon}>{statusIcon}</View>
                          <View style={styles.aiPreviewInfo}>
                            <Text style={styles.aiPreviewName} numberOfLines={1}>
                              {p.item.name || '未命名'}
                              <Text style={styles.aiPreviewCode}> ({p.item.code})</Text>
                            </Text>
                            <Text style={styles.aiPreviewUrl} numberOfLines={1}>{p.item.baseUrl}</Text>
                            {p.errors.length > 0 && (
                              <Text style={styles.aiPreviewError} numberOfLines={2}>{p.errors[0]}</Text>
                            )}
                            {p.existingSource && (
                              <Text style={styles.aiPreviewWarn} numberOfLines={1}>
                                已在库: {p.existingSource.name}
                              </Text>
                            )}
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
                <View style={styles.modalButtons}>
                  {aiResult ? (
                    <Button
                      variant="primary"
                      size="md"
                      style={styles.modalButton}
                      onPress={() => { setAiModalVisible(false); handleAiReset(); }}
                    >
                      完成
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="md"
                        style={styles.modalButton}
                        onPress={() => setAiStep('paste')}
                      >
                        返回修改
                      </Button>
                      <Button
                        variant="primary"
                        size="md"
                        style={styles.modalButton}
                        loading={aiImporting}
                        disabled={aiImporting || aiPreview.filter(p => p.status === 'valid').length === 0}
                        onPress={handleAiImport}
                      >
                        导入 {aiPreview.filter(p => p.status === 'valid').length} 个
                      </Button>
                    </>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
    </BlurredBackground>
  );
}
