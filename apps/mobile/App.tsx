import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, View, ActivityIndicator, useColorScheme, Appearance } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initApp } from './src/init';
import { useThemeStore } from './src/themes/store';
import { useThemeColors } from './src/themes/useThemeColors';
import HomeScreen from './src/pages/HomeScreen';
import SearchScreen from './src/pages/SearchScreen';
import DetailScreen from './src/pages/DetailScreen';
import PlayScreen from './src/pages/PlayScreen';
import SourceManagerScreen from './src/pages/SourceManagerScreen';
import AiSourceImportScreen from './src/pages/AiSourceImportScreen';
import CollectConfigScreen from './src/pages/CollectConfigScreen';
import AppearanceSettingsScreen from './src/pages/AppearanceSettingsScreen';
import UsagePreferencesScreen from './src/pages/UsagePreferencesScreen';
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
        <Stack.Screen name="Detail" component={DetailScreen} options={{ animation: 'default' }} />
        <Stack.Screen name="Play" component={PlayScreen} options={{ animation: 'default' }} />
        <Stack.Screen name="SourceManager" component={SourceManagerScreen} />
        <Stack.Screen name="AiSourceImport" component={AiSourceImportScreen} />
        <Stack.Screen name="CollectConfig" component={CollectConfigScreen} />
        <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
        <Stack.Screen name="UsagePreferences" component={UsagePreferencesScreen} />
        <Stack.Screen name="TaskList" component={TaskListScreen} />
        <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
        <Stack.Screen name="CollectGuide" component={CollectGuideScreen} />
        <Stack.Screen name="VideoManagement" component={VideoManagementScreen} />
        <Stack.Screen name="TestCollect" component={TestCollectScreen} />
      </Stack.Navigator>
      <Sidebar />
      <CollectProgressDialog />
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
