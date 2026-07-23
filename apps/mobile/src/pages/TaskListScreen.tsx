import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';
import type { CollectTask } from '@movie-app/core';

interface Props {
  navigation: any;
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'PENDING':
      return { label: '等待中', color: '#888', bg: '#2a2a2a' };
    case 'RUNNING':
      return { label: '运行中', color: '#4a9eff', bg: 'rgba(74,158,255,0.1)' };
    case 'COMPLETED':
      return { label: '已完成', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
    case 'FAILED':
      return { label: '失败', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
    default:
      return { label: status, color: '#888', bg: '#2a2a2a' };
  }
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

function getErrorTypeLabel(errorType: string | null): { label: string; color: string } {
  switch (errorType) {
    case 'NETWORK': return { label: '网络错误', color: '#f97316' };
    case 'TIMEOUT': return { label: '请求超时', color: '#eab308' };
    case 'RATE_LIMIT': return { label: '限流', color: '#ef4444' };
    case 'PARSE': return { label: '解析错误', color: '#a855f7' };
    case 'DB': return { label: '数据库错误', color: '#ec4899' };
    case 'CANCELLED': return { label: '已取消', color: '#888' };
    default: return { label: '', color: '#888' };
  }
}

export default function TaskListScreen({ navigation }: Props) {
  const { collectTasks, loadCollectTasks, deleteCollectTask, deleteOldTasks } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCollectTasks().finally(() => setIsLoading(false));
  }, []);

  const runningCount = collectTasks.filter(t => t.status === 'RUNNING' || t.status === 'PENDING').length;
  const completedCount = collectTasks.filter(t => t.status === 'COMPLETED').length;
  const failedCount = collectTasks.filter(t => t.status === 'FAILED').length;

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

  const handleClearOld = () => {
    Alert.alert('清理旧任务', '确定要删除7天前的任务记录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: async () => {
        await deleteOldTasks(7);
        await loadCollectTasks();
      }},
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>任务列表</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderLeftColor: '#4a9eff' }]}>
          <Text style={[styles.statNumber, { color: '#4a9eff' }]}>{runningCount}</Text>
          <Text style={styles.statLabel}>运行中</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#22c55e' }]}>
          <Text style={[styles.statNumber, { color: '#22c55e' }]}>{completedCount}</Text>
          <Text style={styles.statLabel}>已完成</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#ef4444' }]}>
          <Text style={[styles.statNumber, { color: '#ef4444' }]}>{failedCount}</Text>
          <Text style={styles.statLabel}>失败</Text>
        </View>
      </View>

      <View style={styles.listActions}>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => { setIsLoading(true); loadCollectTasks().finally(() => setIsLoading(false)); }}>
          <Text style={styles.refreshBtnText}>刷新</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClearOld}>
          <Text style={styles.clearBtnText}>清理7天前</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#4a9eff" style={{ marginTop: 40 }} />
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
                  <View style={styles.taskInfo}>
                    <Text style={styles.taskSource}>{task.sourceName || task.sourceCode}</Text>
                    <Text style={styles.taskType}>{getTypeLabel(task.type)}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    {task.status === 'RUNNING' && <ActivityIndicator size={10} color={statusStyle.color} style={{ marginRight: 4 }} />}
                    <Text style={[styles.statusText, { color: statusStyle.color }]}>{statusStyle.label}</Text>
                  </View>
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
                  <Text style={styles.taskDate}>{new Date(task.createdAt).toLocaleString()}</Text>
                </View>

                {task.errorMessage && (
                  <View>
                    {task.errorType && (() => {
                      const errorTypeInfo = getErrorTypeLabel(task.errorType);
                      return errorTypeInfo.label ? (
                        <View style={[styles.errorTypeBadge, { backgroundColor: errorTypeInfo.color + '20', borderColor: errorTypeInfo.color + '40' }]}>
                          <Text style={[styles.errorTypeText, { color: errorTypeInfo.color }]}>{errorTypeInfo.label}</Text>
                        </View>
                      ) : null;
                    })()}
                    <Text style={styles.taskError} numberOfLines={2}>{task.errorMessage}</Text>
                  </View>
                )}

                <TouchableOpacity style={styles.deleteTaskBtn} onPress={() => handleDelete(task)}>
                  <Text style={styles.deleteTaskBtnText}>删除</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 15, gap: 10, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, borderLeftWidth: 3 },
  statNumber: { fontSize: 24, fontWeight: 'bold' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  listActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 15, marginBottom: 15 },
  refreshBtn: { flex: 1, paddingVertical: 10, backgroundColor: '#1a1a1a', borderRadius: 8, alignItems: 'center' },
  refreshBtnText: { color: '#4a9eff', fontSize: 14 },
  clearBtn: { flex: 1, paddingVertical: 10, backgroundColor: '#1a1a1a', borderRadius: 8, alignItems: 'center' },
  clearBtnText: { color: '#ef4444', fontSize: 14 },
  empty: { color: '#888', textAlign: 'center', marginTop: 60, fontSize: 16 },
  taskList: { paddingHorizontal: 15, gap: 10, paddingBottom: 30 },
  taskCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 15 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  taskInfo: { flex: 1 },
  taskSource: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 2 },
  taskType: { fontSize: 12, color: '#888' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '500' },
  taskProgress: { marginBottom: 10 },
  progressBar: { height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: '#4a9eff', borderRadius: 2 },
  progressText: { fontSize: 11, color: '#666', textAlign: 'right' },
  taskMeta: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  taskStat: { fontSize: 12, color: '#888' },
  taskDate: { fontSize: 11, color: '#555', marginLeft: 'auto' },
  taskError: { fontSize: 12, color: '#ef4444', marginBottom: 8, backgroundColor: 'rgba(239,68,68,0.05)', padding: 8, borderRadius: 6 },
  errorTypeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, marginBottom: 4 },
  errorTypeText: { fontSize: 11, fontWeight: '500' },
  deleteTaskBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 6, backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: 6 },
  deleteTaskBtnText: { color: '#ff6b6b', fontSize: 13 },
});
