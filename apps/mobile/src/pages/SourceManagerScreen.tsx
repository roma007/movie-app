import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert, Modal, TextInput } from 'react-native';
import { useAppStore } from '../useAppStore';
import type { VideoSource } from '@movie-app/core';

interface Props {
  navigation: any;
}

const RATE_BARS = [2, 4, 6, 8, 10];

function getBarColor(level: number, threshold: number): string {
  if (level >= threshold) return '#22c55e';
  if (level >= threshold - 1) return '#eab308';
  return '#4b5563';
}

function getHealthLabel(source: VideoSource): { label: string; color: string } {
  const failCount = source.failCount || 0;
  const totalRequests = source.totalRequests || 0;
  const status = source.healthStatus;
  const failRate = totalRequests > 0 ? (failCount / totalRequests) * 100 : 0;

  if (status === 'DOWN' || status === 'unhealthy') {
    return { label: '源不可用，建议降速', color: '#ef4444' };
  }
  if (failRate > 20) {
    return { label: '失败较多，建议降速', color: '#ef4444' };
  }
  if (status === 'DEGRADED' || status === 'degraded' || failRate > 10) {
    return { label: '状态不稳定，建议降速', color: '#eab308' };
  }
  if (failRate < 5 && (source.rateLimit || 0) < 5) {
    return { label: '状态良好，可以加速', color: '#22c55e' };
  }
  return { label: '状态稳定，保持速率', color: '#22c55e' };
}

export default function SourceManagerScreen(_: Props) {
  const { videoSources, loadVideoSources, toggleSourceEnabled, removeVideoSource, addVideoSource, reorderSource, updateSourceRateLimit } = useAppStore();
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });

  useEffect(() => {
    loadVideoSources();
  }, []);

  const handleDelete = (id: string, name: string) => {
    Alert.alert('删除视频源', `确定要删除「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeVideoSource(id) },
    ]);
  };

  const handleMove = async (index: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= videoSources.length) return;
    const a = videoSources[index];
    const b = videoSources[target];
    await reorderSource(a.id, b.priority);
    await reorderSource(b.id, a.priority);
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
      priority: Number(form.priority) || 0,
      healthStatus: null,
      lastCheckAt: null,
    };
    addVideoSource(source);
    setForm({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });
    setModalVisible(false);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>视频源管理</Text>
      </View>

      <View style={styles.list}>
        {videoSources.map((source: VideoSource, index: number) => {
          const health = getHealthLabel(source);
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
                  trackColor={{ false: '#333', true: '#4a9eff' }}
                  thumbColor={source.isEnabled ? '#fff' : '#666'}
                />
              </View>
              <Text style={styles.sourceUrl}>{source.baseUrl}</Text>
              
              <View style={styles.rateRow}>
                <TouchableOpacity
                  style={styles.rateButton}
                  onPress={() => handleAdjustRate(source, -1)}
                >
                  <Text style={styles.rateButtonText}>▼</Text>
                </TouchableOpacity>
                <View style={styles.rateBars}>
                  {RATE_BARS.map((threshold, idx) => (
                    <View
                      key={idx}
                      style={[styles.rateBar, { backgroundColor: getBarColor(source.rateLimit, threshold) }]}
                    />
                  ))}
                </View>
                <Text style={styles.rateLabel}>{source.rateLimit}</Text>
                <TouchableOpacity
                  style={styles.rateButton}
                  onPress={() => handleAdjustRate(source, 1)}
                >
                  <Text style={styles.rateButtonText}>▲</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={[styles.healthLabel, { color: health.color }]}>{health.label}</Text>
              
              <View style={styles.sourceFooter}>
                <Text style={styles.priority}>优先级: {source.priority}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionButton, index === 0 && styles.actionButtonDisabled]}
                    disabled={index === 0}
                    onPress={() => handleMove(index, 'up')}
                  >
                    <Text style={styles.actionText}>上移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, index === videoSources.length - 1 && styles.actionButtonDisabled]}
                    disabled={index === videoSources.length - 1}
                    onPress={() => handleMove(index, 'down')}
                  >
                    <Text style={styles.actionText}>下移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.deleteButton]}
                    onPress={() => handleDelete(source.id, source.name)}
                  >
                    <Text style={[styles.actionText, styles.deleteText]}>删除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
        <Text style={styles.addButtonText}>添加视频源</Text>
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>添加视频源</Text>
            <TextInput
              style={styles.input}
              placeholder="编码（唯一标识）"
              placeholderTextColor="#666"
              value={form.code}
              onChangeText={(text) => setForm({ ...form, code: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="名称"
              placeholderTextColor="#666"
              value={form.name}
              onChangeText={(text) => setForm({ ...form, name: text })}
            />
            <TextInput
              style={styles.input}
              placeholder="API 地址"
              placeholderTextColor="#666"
              value={form.baseUrl}
              onChangeText={(text) => setForm({ ...form, baseUrl: text })}
            />
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputHalf]}
                placeholder="速率限制"
                placeholderTextColor="#666"
                keyboardType="numeric"
                value={form.rateLimit}
                onChangeText={(text) => setForm({ ...form, rateLimit: text })}
              />
              <TextInput
                style={[styles.input, styles.inputHalf]}
                placeholder="优先级"
                placeholderTextColor="#666"
                keyboardType="numeric"
                value={form.priority}
                onChangeText={(text) => setForm({ ...form, priority: text })}
              />
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.modalButtonOutline]} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButton} onPress={handleAdd}>
                <Text style={styles.modalButtonText}>添加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  list: { paddingHorizontal: 15, gap: 12 },
  sourceCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 15 },
  sourceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sourceMain: { flex: 1 },
  sourceName: { fontSize: 17, fontWeight: '600', color: '#fff', marginBottom: 4 },
  sourceCode: { fontSize: 12, color: '#666' },
  sourceUrl: { fontSize: 13, color: '#888', marginBottom: 10 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  rateButton: { padding: 4 },
  rateButtonText: { color: '#ccc', fontSize: 14 },
  rateBars: { flexDirection: 'row', gap: 3 },
  rateBar: { width: 8, height: 16, borderRadius: 2 },
  rateLabel: { fontSize: 14, color: '#ccc', width: 24, textAlign: 'center' },
  healthLabel: { fontSize: 12, marginBottom: 10 },
  sourceFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priority: { fontSize: 13, color: '#666' },
  actions: { flexDirection: 'row', gap: 8 },
  actionButton: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#2a2a2a', borderRadius: 6 },
  actionButtonDisabled: { opacity: 0.4 },
  actionText: { color: '#ccc', fontSize: 13 },
  deleteButton: { backgroundColor: 'rgba(255, 107, 107, 0.15)' },
  deleteText: { color: '#ff6b6b' },
  addButton: { margin: 15, paddingVertical: 16, backgroundColor: '#4a9eff', borderRadius: 12, alignItems: 'center' },
  addButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  input: { backgroundColor: '#2a2a2a', color: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, fontSize: 15 },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputHalf: { flex: 1 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalButton: { flex: 1, paddingVertical: 14, backgroundColor: '#4a9eff', borderRadius: 8, alignItems: 'center' },
  modalButtonOutline: { backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#444' },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
