import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import { useAppStore } from '../useAppStore';

interface Props {
  navigation: any;
}

export default function SourceManagerScreen(_: Props) {
  const { videoSources, loadVideoSources, toggleSourceEnabled, removeVideoSource } = useAppStore();

  useEffect(() => {
    loadVideoSources();
  }, []);

  const handleDelete = (id: string, name: string) => {
    Alert.alert('删除视频源', `确定要删除「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeVideoSource(id) },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>视频源管理</Text>
      </View>

      <View style={styles.list}>
        {videoSources.map((source: any, index: number) => (
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
            <View style={styles.sourceFooter}>
              <Text style={styles.priority}>优先级: {source.priority}</Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionButton, index === 0 && styles.actionButtonDisabled]}
                  disabled={index === 0}
                >
                  <Text style={styles.actionText}>上移</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, index === videoSources.length - 1 && styles.actionButtonDisabled]}
                  disabled={index === videoSources.length - 1}
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
        ))}
      </View>

      <TouchableOpacity style={styles.addButton}>
        <Text style={styles.addButtonText}>添加视频源</Text>
      </TouchableOpacity>
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
  sourceUrl: { fontSize: 13, color: '#888', marginBottom: 12 },
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
});
