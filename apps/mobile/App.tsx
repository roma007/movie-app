import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initApp } from './src/init';
import { useThemeStore } from './src/themes/store';
import { useThemeColors } from './src/themes/useThemeColors';
import HomeScreen from './src/pages/HomeScreen';
import SearchScreen from './src/pages/SearchScreen';
import SettingsScreen from './src/pages/SettingsScreen';
import DetailScreen from './src/pages/DetailScreen';
import PlayScreen from './src/pages/PlayScreen';
import SourceManagerScreen from './src/pages/SourceManagerScreen';
import CollectConfigScreen from './src/pages/CollectConfigScreen';
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

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabNavigator() {
  const colors = useThemeColors();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.disabledForeground,
      }}
    >
      <Tab.Screen
        name="首页"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>🏠</Text>
          ),
        }}
      />
      <Tab.Screen
        name="搜索"
        component={SearchScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>🔍</Text>
          ),
        }}
      />
      <Tab.Screen
        name="设置"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>⚙️</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

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
        }}
      >
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen name="Movie" component={MovieScreen} />
        <Stack.Screen name="TV" component={TVScreen} />
        <Stack.Screen name="Variety" component={VarietyScreen} />
        <Stack.Screen name="Anime" component={AnimeScreen} />
        <Stack.Screen name="Documentary" component={DocumentaryScreen} />
        <Stack.Screen name="Detail" component={DetailScreen} />
        <Stack.Screen name="Play" component={PlayScreen} />
        <Stack.Screen name="SourceManager" component={SourceManagerScreen} />
        <Stack.Screen name="CollectConfig" component={CollectConfigScreen} />
        <Stack.Screen name="TaskList" component={TaskListScreen} />
        <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
        <Stack.Screen name="CollectGuide" component={CollectGuideScreen} />
        <Stack.Screen name="VideoManagement" component={VideoManagementScreen} />
        <Stack.Screen name="TestCollect" component={TestCollectScreen} />
      </Stack.Navigator>
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const initTheme = useThemeStore((s) => s.initTheme);
  const colors = useThemeColors();

  useEffect(() => {
    Promise.all([initApp(), initTheme()])
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
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>正在加载...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
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
  tabIcon: {
    fontSize: 20,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
  },
});
