import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react-native';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import type { CollectTask } from '@movie-app/core';

interface Props {
  navigation: any;
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'INCREMENTAL': return '增量采集';
    case 'FULL': return '全量采集';
    case 'KEYWORD': return '关键词采集';
    case 'REPROBE': return '重新探测';
    default: return type;
  }
}

export default function TaskListScreen({ navigation }: Props) {
  const { collectTasks, loadCollectTasks, deleteCollectTask, deleteOldTasks, resumeCollectTask } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const [isLoading, setIsLoading] = useState(true);
  const [resumingId, setResumingId] = useState<string | null>(null);

  function getStatusStyle(status: string) {
    switch (status) {
      case 'PENDING':
        return { label: '等待中', color: colors.mutedForeground };
      case 'RUNNING':
        return { label: '运行中', color: colors.text };
      case 'COMPLETED':
        return { label: '已完成', color: colors.success };
      case 'FAILED':
        return { label: '失败', color: colors.error };
      default:
        return { label: status, color: colors.mutedForeground };
    }
  }

  function getErrorTypeLabel(errorType: string | null): { label: string; color: string } {
    switch (errorType) {
      case 'NETWORK': return { label: '网络错误', color: '#f97316' };
      case 'TIMEOUT': return { label: '请求超时', color: colors.warning };
      case 'RATE_LIMIT': return { label: '限流', color: colors.error };
      case 'PARSE': return { label: '解析错误', color: '#a855f7' };
      case 'DB': return { label: '数据库错误', color: '#ec4899' };
      case 'CANCELLED': return { label: '已取消', color: colors.mutedForeground };
      default: return { label: '', color: colors.mutedForeground };
    }
  }

  useEffect(() => {
    loadCollectTasks().finally(() => setIsLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCollectTasks().catch(() => {});
    }, [loadCollectTasks])
  );

  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused) return;
    const hasActive = collectTasks.some((t) => t.status === 'RUNNING' || t.status === 'PENDING');
    if (!hasActive) return;
    const id = setInterval(() => {
      loadCollectTasks();
    }, 2000);
    return () => clearInterval(id);
  }, [isFocused, collectTasks, loadCollectTasks]);

  const handleDelete = (task: CollectTask) => {
    if (task.status === 'RUNNING' || task.status === 'PENDING') {
      Alert.alert('删除任务', `确定要删除此${task.status === 'RUNNING' ? '运行中' : '等待中'}的任务吗？`, [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => deleteCollectTask(task.taskId) },
      ]);
    } else {
      deleteCollectTask(task.taskId);
    }
  };

  const handleResume = async (task: CollectTask) => {
    setResumingId(task.taskId);
    try {
      const result = await resumeCollectTask(task.taskId);
      if (!result.success) {
        Alert.alert('续采失败', result.error || '未知错误');
      }
    } catch (err: any) {
      Alert.alert('续采失败', err.message || '未知错误');
    } finally {
      setResumingId(null);
      await loadCollectTasks().catch(() => {});
    }
  };

  const handleClearAll = () => {
    Alert.alert('清理所有任务', '确定要删除所有任务记录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: async () => {
        await deleteOldTasks(999999);
        await loadCollectTasks();
      }},
    ]);
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    headerActions: { flexDirection: 'row', gap: 8 },
    empty: { color: colors.mutedForeground, textAlign: 'center', marginTop: 60, fontSize: s(16) },
    taskList: { paddingHorizontal: 15, gap: 10, paddingBottom: 30 },
    taskCard: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 15 },
    taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    taskSource: { fontSize: s(16), fontWeight: '600', color: colors.text },
    taskType: { fontSize: s(12), color: colors.mutedForeground },
    statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
    statusText: { fontSize: s(12), fontWeight: '500' },
    taskProgress: { marginBottom: 10 },
    progressBar: { height: 4, backgroundColor: colors.trackBg, borderRadius: radius.progress, overflow: 'hidden', marginBottom: 4 },
    progressFill: { height: '100%', backgroundColor: colors.mutedForeground, borderRadius: radius.progress },
    progressText: { fontSize: s(11), color: colors.disabledForeground, textAlign: 'right' },
    taskMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    taskStat: { fontSize: s(12), color: colors.mutedForeground },
    taskDate: { fontSize: s(11), color: colors.disabledForeground, marginLeft: 'auto' },
    taskRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  }), [colors, cardBg, surfaceBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>任务列表</Text>
          <View style={styles.headerActions}>
            <Button variant="secondary" size="sm" onPress={handleClearAll}>
              <Trash2 size={16} color={colors.text} />
            </Button>
            <Button variant="primary" size="sm" onPress={() => { setIsLoading(true); loadCollectTasks().finally(() => setIsLoading(false)); }}>
              <RefreshCw size={16} color={colors.text} />
            </Button>
          </View>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.mutedForeground} style={{ marginTop: 40 }} />
      ) : collectTasks.length === 0 ? (
        <Text style={styles.empty}>暂无采集任务</Text>
      ) : (
        <View style={styles.taskList}>
          {collectTasks.map((task: CollectTask) => {
            const statusStyle = getStatusStyle(task.status);
            const progress = task.totalPages > 0 ? Math.round((task.currentPage / task.totalPages) * 100) : 0;
            return (
              <View key={task.taskId || task.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <Text style={styles.taskSource}>{task.sourceName || task.sourceCode}</Text>
                  <Text style={styles.taskType}>{getTypeLabel(task.type)}</Text>
                  <Text style={styles.taskDate}>{new Date(task.createdAt).toLocaleString()}</Text>
                </View>

                {(task.status === 'RUNNING' || task.status === 'PENDING') && (
                  <View style={styles.taskProgress}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.progressText}>{task.currentPage}/{task.totalPages} 页</Text>
                  </View>
                )}

                <View style={styles.taskMeta}>
                  <Text style={styles.taskStat}>成功: {task.collectedCount}</Text>
                  <Text style={styles.taskStat}>失败: {task.failedCount}</Text>
                  {task.type === 'REPROBE' && (task.shortDramaCount || task.longDramaCount) ? (
                    <>
                      <Text style={[styles.taskStat, { color: colors.success }]}>短剧: {task.shortDramaCount || 0}</Text>
                      <Text style={[styles.taskStat, { color: colors.textSecondary }]}>长剧: {task.longDramaCount || 0}</Text>
                    </>
                  ) : null}
                    <View style={styles.taskRight}>
                      <View style={[styles.statusBadge, { borderColor: statusStyle.color }]}>
                        {task.status === 'RUNNING' && <ActivityIndicator size={10} color={statusStyle.color} style={{ marginRight: 4 }} />}
                        <Text style={[styles.statusText, { color: statusStyle.color }]}>{statusStyle.label}</Text>
                      </View>
                      {task.status === 'FAILED' && (task.type === 'INCREMENTAL' || task.type === 'FULL') && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onPress={() => handleResume(task)}
                          disabled={resumingId === task.taskId}
                        >
                          {resumingId === task.taskId ? (
                            <ActivityIndicator size={12} color={colors.text} style={{ marginRight: 4 }} />
                          ) : null}
                          {resumingId === task.taskId ? '续采中...' : '继续'}
                        </Button>
                      )}
                      <Button variant="secondary" size="sm" onPress={() => handleDelete(task)} disabled={resumingId === task.taskId}>
                        删除
                      </Button>
                    </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
    </BlurredBackground>
  );
}
