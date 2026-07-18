import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';

interface Props {
  navigation: any;
}

export default function VideoManagementScreen(_: Props) {
  const {
    deleteAllMedia, deleteMediaWithoutPlaySource, deleteMediaByGenres,
    getSubTypesByType, getHiddenMediaCount, hideMediaByGenres, unhideMediaByGenres,
  } = useAppStore();

  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);

  useEffect(() => {
    getHiddenMediaCount().then(setHiddenCount).catch(() => {});
  }, []);

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

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>视频管理</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>危险操作</Text>
          <Text style={styles.warningText}>以下操作不可恢复，请谨慎使用</Text>

          <TouchableOpacity
            style={[styles.dangerBtn, deletingAll && styles.btnDisabled]}
            onPress={handleDeleteAll}
            disabled={deletingAll}
          >
            {deletingAll ? (
              <ActivityIndicator size="small" color="#fff" />
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
              <ActivityIndicator size="small" color="#fff" />
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  content: { paddingHorizontal: 15, gap: 12 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  text: { fontSize: 14, color: '#bbb', lineHeight: 22 },
  warningText: { fontSize: 13, color: '#ef4444' },
  dangerBtn: { paddingVertical: 14, backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 8, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  dangerBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '500' },
});
