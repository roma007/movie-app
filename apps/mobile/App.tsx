import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, View, ActivityIndicator, useColorScheme, Appearance, AppState } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';

// 全局 JS 错误捕获：未捕获异常/未处理 rejection 写入本地 js_error.log（仅写日志，不改变行为）。
// 用于「播放页返回闪退」一类 JS fatal 的诊断留存；本地开发/线上排障时可取出该文件定位。
function setupJSErrorLog() {
  try {
    // 同步写（覆盖写最新一条），栈溢出等极端场景下异步 .then 可能来不及落盘
    const write = (tag: string, msg: string | null | undefined) => {
      try {
        const line = `[${new Date().toISOString()}] ${tag}: ${msg || 'no message'}\n`;
        const file = new File(Paths.cache, 'js_error.log');
        try { file.create({ overwrite: true }); } catch {}
        try { file.write(line); } catch {}
      } catch {}
    };
    write('BOOT', '启动，等待 JS 全局错误');
    const g = globalThis as any;
    const orig = g.ErrorUtils && g.ErrorUtils.getGlobalHandler && g.ErrorUtils.getGlobalHandler();
    if (g.ErrorUtils && g.ErrorUtils.setGlobalHandler) {
      g.ErrorUtils.setGlobalHandler((err: any, isFatal?: boolean) => {
        try {
          const stack = (err && err.stack) || (err && err.message) || '';
          write('FATAL' + (isFatal ? '(fatal)' : ''), stack);
        } catch {}
        if (orig) { try { orig(err, isFatal); } catch {} }
      });
    }
    if (g.HermesInternal && g.HermesInternal.enablePromiseRejectionTracker) {
      g.HermesInternal.enablePromiseRejectionTracker({
        onUnhandledRejection: (e: any) => { try { write('UNHANDLED_REJECTION', (e && (e.stack || e.message)) || String(e)); } catch {} },
        onRejected: (msg: string) => { try { write('REJECTED_FINAL', msg); } catch {} },
      });
    }
  } catch {}
}
setupJSErrorLog();

import { initApp, getStore } from './src/init';
import { useThemeStore } from './src/themes/store';
import { useThemeColors } from './src/themes/useThemeColors';
import HomeScreen from './src/pages/HomeScreen';
import SearchScreen from './src/pages/SearchScreen';
import PlayScreen from './src/pages/PlayScreen';
import SourceManagerScreen from './src/pages/SourceManagerScreen';
import AiSourceImportScreen from './src/pages/AiSourceImportScreen';
import CollectConfigScreen from './src/pages/CollectConfigScreen';
import AppearanceSettingsScreen from './src/pages/AppearanceSettingsScreen';
import UsagePreferencesScreen from './src/pages/UsagePreferencesScreen';
import RecommendationSettingsScreen from './src/pages/RecommendationSettingsScreen';
import VoiceControlSettingsScreen from './src/pages/VoiceControlSettingsScreen';
import TaskListScreen from './src/pages/TaskListScreen';
import HelpCenterScreen from './src/pages/HelpCenterScreen';
import CollectGuideScreen from './src/pages/CollectGuideScreen';
import VideoManagementScreen from './src/pages/VideoManagementScreen';
import TestCollectScreen from './src/pages/TestCollectScreen';
import MovieScreen from './src/pages/MovieScreen';
import TVScreen from './src/pages/TVScreen';
import VarietyScreen from './src/pages/VarietyScreen';
import AnimeScreen from './src/pages/AnimeScreen';
import DocumentaryScreen from './src/pages/DocumentaryScreen';
import Sidebar from './src/components/Sidebar';
import CollectProgressDialog from './src/components/CollectProgressDialog';
import { GlobalVoiceControl } from './src/components/GlobalVoiceControl';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const colors = useThemeColors();
  const isLight = useThemeStore((s) => s.currentTheme === 'light');
  return (
    <>
      <StatusBar style={isLight ? 'dark' : 'light'} />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'none',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'default' }} />
        <Stack.Screen name="Movie" component={MovieScreen} />
        <Stack.Screen name="TV" component={TVScreen} />
        <Stack.Screen name="Variety" component={VarietyScreen} />
        <Stack.Screen name="Anime" component={AnimeScreen} />
        <Stack.Screen name="Documentary" component={DocumentaryScreen} />
        <Stack.Screen name="Play" component={PlayScreen} options={{ animation: 'default' }} />
        <Stack.Screen name="SourceManager" component={SourceManagerScreen} />
        <Stack.Screen name="AiSourceImport" component={AiSourceImportScreen} />
        <Stack.Screen name="CollectConfig" component={CollectConfigScreen} />
        <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
        <Stack.Screen name="UsagePreferences" component={UsagePreferencesScreen} />
        <Stack.Screen name="RecommendationSettings" component={RecommendationSettingsScreen} />
        <Stack.Screen name="VoiceControlSettings" component={VoiceControlSettingsScreen} />
        <Stack.Screen name="TaskList" component={TaskListScreen} />
        <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
        <Stack.Screen name="CollectGuide" component={CollectGuideScreen} />
        <Stack.Screen name="VideoManagement" component={VideoManagementScreen} />
        <Stack.Screen name="TestCollect" component={TestCollectScreen} />
      </Stack.Navigator>
      <Sidebar />
      <CollectProgressDialog />
      <GlobalVoiceControl />
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const initTheme = useThemeStore((s) => s.initTheme);
  const initColorMode = useThemeStore((s) => s.initColorMode);
  const setSystemColorScheme = useThemeStore((s) => s.setSystemColorScheme);
  const initBlurIntensity = useThemeStore((s) => s.initBlurIntensity);
  const initImageBlur = useThemeStore((s) => s.initImageBlur);
  const initImageScale = useThemeStore((s) => s.initImageScale);
  const initCardOpacity = useThemeStore((s) => s.initCardOpacity);
  const initFontSizeScale = useThemeStore((s) => s.initFontSizeScale);
  const themeName = useThemeStore((s) => s.currentTheme);
  const colors = useThemeColors();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (colorScheme === 'dark' || colorScheme === 'light') {
      setSystemColorScheme(colorScheme);
    }
    const subscription = Appearance.addChangeListener(({ colorScheme: newScheme }) => {
      if (newScheme === 'dark' || newScheme === 'light') {
        setSystemColorScheme(newScheme);
      }
    });
    return () => subscription.remove();
  }, [setSystemColorScheme]);

  useEffect(() => {
    Promise.all([initApp(), initTheme(), initColorMode(), initBlurIntensity(), initImageBlur(), initImageScale(), initCardOpacity(), initFontSizeScale()])
      .then(() => setReady(true))
      .catch((err) => {
        console.error('初始化失败:', err);
        setReady(true);
      });
  }, []);

  useEffect(() => {
    // 移动端后台定时器会被挂起，回前台时补一次自动增量采集检查
    if (!ready) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getStore().getState().maybeRunAutoCollect('resume').catch(() => {});
      }
    });
    return () => sub.remove();
  }, [ready]);

  if (!ready) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.mutedForeground} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>正在加载...</Text>
      </View>
    );
  }

  const navTheme = themeName === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
});
