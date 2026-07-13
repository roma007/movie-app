import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useAppStore } from '../useAppStore';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react-native';

interface Props {
  navigation: any;
}

export default function CollectConfigScreen({ navigation }: Props) {
  const { collectConfig, loadCollectConfig, updateCollectConfig } = useAppStore();
  const [localConfig, setLocalConfig] = useState({
    minYear: '2025',
    blacklistKeywords: '',
    rateLimitPerSecond: '2',
    retryTimes: '3',
    pageSize: '20',
    maxPages: '10',
    concurrency: '1',
  });

  useEffect(() => {
    loadCollectConfig();
  }, []);

  useEffect(() => {
    if (collectConfig) {
      setLocalConfig({
        minYear: String(collectConfig.minYear),
        blacklistKeywords: collectConfig.blacklistKeywords.join('\n'),
        rateLimitPerSecond: String(collectConfig.rateLimitPerSecond),
        retryTimes: String(collectConfig.retryTimes),
        pageSize: String(collectConfig.pageSize),
        maxPages: String(collectConfig.maxPages),
        concurrency: String(collectConfig.concurrency),
      });
    }
  }, [collectConfig]);

  const handleSave = async () => {
    const keywords = localConfig.blacklistKeywords
      .split('\n')
      .map(k => k.trim())
      .filter(Boolean);

    await updateCollectConfig({
      minYear: parseInt(localConfig.minYear) || 2025,
      blacklistKeywords: keywords,
      rateLimitPerSecond: Math.min(50, Math.max(1, parseInt(localConfig.rateLimitPerSecond) || 2)),
      retryTimes: Math.min(10, Math.max(0, parseInt(localConfig.retryTimes) || 3)),
      pageSize: Math.min(100, Math.max(5, parseInt(localConfig.pageSize) || 20)),
      maxPages: Math.min(200, Math.max(1, parseInt(localConfig.maxPages) || 10)),
      concurrency: Math.min(20, Math.max(1, parseInt(localConfig.concurrency) || 1)),
    });

    Alert.alert('成功', '配置已保存');
  };

  const handleReset = () => {
    setLocalConfig({
      minYear: '2025',
      blacklistKeywords: [
        '足球', '篮球', '排球', '网球', '羽毛球', '乒乓球', '橄榄球', '棒球',
        '高尔夫', '斯诺克', '台球', '体育', '运动', '赛事', '比赛', '决赛',
        '半决赛', '预告片', '预告', '先行预告', '前瞻', '幕后花絮', '花絮',
        '特辑', '纪录片预告', '预告版', '预告篇',
      ].join('\n'),
      rateLimitPerSecond: '2',
      retryTimes: '3',
      pageSize: '20',
      maxPages: '10',
      concurrency: '1',
    });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>采集配置</Text>
          <View style={styles.placeholder} />
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.formItem}>
          <Text style={styles.label}>最小年份过滤</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.minYear}
            onChangeText={(text) => setLocalConfig({ ...localConfig, minYear: text })}
          />
          <Text style={styles.hint}>低于此年份的内容将被跳过</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>请求速率限制</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.rateLimitPerSecond}
            onChangeText={(text) => setLocalConfig({ ...localConfig, rateLimitPerSecond: text })}
          />
          <Text style={styles.hint}>每秒最大请求数（1-50）</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>失败重试次数</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.retryTimes}
            onChangeText={(text) => setLocalConfig({ ...localConfig, retryTimes: text })}
          />
          <Text style={styles.hint}>采集失败时重试次数（0-10）</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>每页大小</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.pageSize}
            onChangeText={(text) => setLocalConfig({ ...localConfig, pageSize: text })}
          />
          <Text style={styles.hint}>每次请求获取的视频数量（5-100）</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>最大采集页数</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.maxPages}
            onChangeText={(text) => setLocalConfig({ ...localConfig, maxPages: text })}
          />
          <Text style={styles.hint}>全量采集时最多翻页数量（1-200）</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>并发处理数量</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={localConfig.concurrency}
            onChangeText={(text) => setLocalConfig({ ...localConfig, concurrency: text })}
          />
          <Text style={styles.hint}>同时处理的视频数量（1-20）</Text>
        </View>

        <View style={styles.formItem}>
          <Text style={styles.label}>黑名单关键词</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={8}
            value={localConfig.blacklistKeywords}
            onChangeText={(text) => setLocalConfig({ ...localConfig, blacklistKeywords: text })}
            placeholder="每行一个关键词"
            placeholderTextColor="#666"
          />
          <Text style={styles.hint}>采集时会过滤包含这些关键词的内容</Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.button, styles.buttonOutline]} onPress={handleReset}>
            <RotateCcw size={18} color="#fff" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>重置默认</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={handleSave}>
            <Save size={18} color="#fff" style={styles.buttonIcon} />
            <Text style={styles.buttonText}>保存配置</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15, backgroundColor: '#111' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: { padding: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  placeholder: { width: 40 },
  content: { padding: 15 },
  formItem: { marginBottom: 20 },
  label: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 8 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, fontSize: 15 },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#666', marginTop: 6 },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: '#4a9eff', borderRadius: 8 },
  buttonOutline: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  buttonIcon: { marginRight: 6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
