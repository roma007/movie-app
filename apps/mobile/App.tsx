import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initApp } from './src/init';
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
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0f0f0f',
          borderTopColor: '#1f1f1f',
        },
        tabBarActiveTintColor: '#4a9eff',
        tabBarInactiveTintColor: '#666',
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

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initApp().then(() => setReady(true)).catch(err => {
      console.error('初始化失败:', err);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#4a9eff" />
        <Text style={styles.loadingText}>正在加载...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0f0f0f' },
          }}
        >
          <Stack.Screen name="Tabs" component={TabNavigator} />
          <Stack.Screen
            name="Movie"
            component={MovieScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TV"
            component={TVScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Variety"
            component={VarietyScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Anime"
            component={AnimeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Documentary"
            component={DocumentaryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Detail"
            component={DetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Play"
            component={PlayScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="SourceManager"
            component={SourceManagerScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="CollectConfig"
            component={CollectConfigScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TaskList"
            component={TaskListScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="HelpCenter"
            component={HelpCenterScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="CollectGuide"
            component={CollectGuideScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="VideoManagement"
            component={VideoManagementScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TestCollect"
            component={TestCollectScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
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
