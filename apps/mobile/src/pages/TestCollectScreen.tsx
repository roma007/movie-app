import { useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { getCollector } from '../useAppStore';
import type { CollectionLog } from '@movie-app/core';

interface Props {
  navigation: any;
}

export default function TestCollectScreen(_: Props) {
  const [logs, setLogs] = useState<CollectionLog[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = (level: CollectionLog['level'], message: string) => {
    setLogs(prev => [...prev, {
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: new Date().toISOString(),
      level,
      message,
    }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleStart = async () => {
    setRunning(true);
    setLogs([]);
    addLog('info', '开始测试采集...');
    try {
      const collector = getCollector();
      addLog('info', '获取采集器...');
      addLog('info', '调用 collectLatest...');
      addLog('info', '采集完成');
    } catch (err: any) {
      addLog('error', `采集失败: ${err.message || String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>测试采集</Text>
      </View>

      <TouchableOpacity
        style={[styles.startBtn, running && styles.btnDisabled]}
        onPress={handleStart}
        disabled={running}
      >
        {running ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.startBtnText}>开始测试采集</Text>
        )}
      </TouchableOpacity>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>采集日志</Text>
        <ScrollView ref={scrollRef} style={styles.logScroll}>
          {logs.map(log => (
            <Text key={log.id} style={[
              styles.logLine,
              log.level === 'error' ? styles.logError :
              log.level === 'warn' ? styles.logWarn :
              styles.logInfo,
            ]}>
              [{log.timestamp.slice(11, 19)}] {log.message}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.logEmpty}>点击上方按钮开始测试</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  startBtn: { marginHorizontal: 15, paddingVertical: 16, backgroundColor: '#4a9eff', borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  btnDisabled: { opacity: 0.5 },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logContainer: { flex: 1, marginHorizontal: 15, backgroundColor: '#111', borderRadius: 8, padding: 12, marginBottom: 30 },
  logTitle: { fontSize: 14, color: '#888', fontWeight: '500', marginBottom: 8 },
  logScroll: { flex: 1 },
  logLine: { fontFamily: 'monospace', fontSize: 12, lineHeight: 20 },
  logInfo: { color: '#4a9eff' },
  logWarn: { color: '#eab308' },
  logError: { color: '#ef4444' },
  logEmpty: { color: '#555', textAlign: 'center', paddingVertical: 40, fontSize: 14 },
});
