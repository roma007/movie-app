import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';

export default function HomeScreen() {
  const { mediaList, isLoading, loadMediaList } = useAppStore();

  useEffect(() => {
    loadMediaList({ page: 1, pageSize: 20 });
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>电影</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#fff" style={styles.loading} />
      ) : (
        <View style={styles.content}>
          {mediaList.length === 0 ? (
            <Text style={styles.empty}>暂无数据，请先采集视频</Text>
          ) : (
            <Text style={styles.count}>已收录 {mediaList.length} 部视频</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  content: { padding: 20 },
  loading: { marginTop: 50 },
  empty: { color: '#888', textAlign: 'center', fontSize: 16 },
  count: { color: '#aaa', fontSize: 14 },
});
