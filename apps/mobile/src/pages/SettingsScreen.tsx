import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert } from 'react-native';
import { useAppStore } from '../useAppStore';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const { videoSources, loadVideoSources, toggleSourceEnabled, clearHistory } = useAppStore();

  useEffect(() => {
    loadVideoSources();
  }, []);

  const handleClearHistory = () => {
    Alert.alert('确认清除', '确定要清除所有观看历史吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: () => clearHistory() },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>设置</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>视频源管理</Text>
        {videoSources.map((source: any) => (
          <View key={source.id} style={styles.sourceItem}>
            <View style={styles.sourceInfo}>
              <Text style={styles.sourceName}>{source.name}</Text>
              <Text style={styles.sourceUrl} numberOfLines={1}>{source.baseUrl}</Text>
            </View>
            <Switch
              value={source.isEnabled}
              onValueChange={(value) => toggleSourceEnabled(source.id, value)}
              trackColor={{ false: '#333', true: '#4a9eff' }}
              thumbColor={source.isEnabled ? '#fff' : '#666'}
            />
          </View>
        ))}
        <TouchableOpacity
          style={styles.manageButton}
          onPress={() => navigation.navigate('SourceManager')}
        >
          <Text style={styles.manageButtonText}>管理视频源</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>数据管理</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CollectConfig')}>
          <Text style={styles.menuText}>采集配置</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('TaskList')}>
          <Text style={styles.menuText}>采集任务</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('VideoManagement')}>
          <Text style={styles.menuText}>视频管理</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={handleClearHistory}>
          <Text style={styles.menuText}>清除观看历史</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>辅助</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('CollectGuide')}>
          <Text style={styles.menuText}>采集教程</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('HelpCenter')}>
          <Text style={styles.menuText}>帮助中心</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('TestCollect')}>
          <Text style={styles.menuText}>测试采集</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuText}>版本</Text>
          <Text style={styles.menuValue}>1.0.0</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  section: { marginHorizontal: 15, marginBottom: 20, backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 14, color: '#888', paddingHorizontal: 15, paddingTop: 15, paddingBottom: 10 },
  sourceItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  sourceInfo: { flex: 1 },
  sourceName: { fontSize: 15, color: '#fff', marginBottom: 4 },
  sourceUrl: { fontSize: 12, color: '#666' },
  manageButton: { paddingVertical: 14, alignItems: 'center', backgroundColor: '#1f1f1f' },
  manageButtonText: { color: '#4a9eff', fontSize: 15 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  menuText: { fontSize: 15, color: '#fff' },
  menuValue: { fontSize: 14, color: '#888' },
});
