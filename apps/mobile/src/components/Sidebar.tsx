import { useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { useSidebarStore } from '../stores/sidebarStore';
import { useAppStore } from '../useAppStore';
import { radius } from '../themes/radiusTokens';

const SIDEBAR_WIDTH = 280;

export default function Sidebar() {
  const { isOpen, close } = useSidebarStore();
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();
  const insets = useSafeAreaInsets();
  const { clearHistory } = useAppStore();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: isOpen ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isOpen, anim]);

  const backdropOpacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.4],
  });

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-SIDEBAR_WIDTH, 0],
  });

  const handleNav = (route: string, params?: any) => {
    close();
    setTimeout(() => navigation.navigate(route, params), 300);
  };

  const handleClearHistory = () => {
    Alert.alert('确认清除', '确定要清除所有观看历史吗？', [
      { text: '取消', style: 'cancel' },
      { text: '确定', style: 'destructive', onPress: () => clearHistory() },
    ]);
  };

  const styles = useMemo(() => StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#000',
    },
    sidebar: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      width: SIDEBAR_WIDTH,
      backgroundColor: colors.background,
      paddingTop: insets.top,
      zIndex: 100,
      elevation: 100,
    },
    header: {
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    title: {
      fontSize: s(24),
      fontWeight: 'bold',
      color: colors.text,
    },
    section: {
      marginHorizontal: 12,
      marginBottom: 16,
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    menuItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 15,
    },
    menuText: {
      fontSize: s(15),
      color: colors.text,
    },
    menuValue: {
      fontSize: s(14),
      color: colors.mutedForeground,
    },
    versionItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 15,
    },
  }), [colors, cardBg, insets.top, s]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isOpen ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={close} />
      </Animated.View>
      <Animated.View style={[styles.sidebar, { transform: [{ translateX }] }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>设置</Text>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('UsagePreferences')}>
              <Text style={styles.menuText}>使用偏好</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('AppearanceSettings')}>
              <Text style={styles.menuText}>外观设置</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('SourceManager')}>
              <Text style={styles.menuText}>管理视频源</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('CollectConfig')}>
              <Text style={styles.menuText}>采集配置</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('TaskList')}>
              <Text style={styles.menuText}>采集任务</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('VideoManagement')}>
              <Text style={styles.menuText}>视频管理</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleClearHistory}>
              <Text style={styles.menuText}>清除观看历史</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('HelpCenter')}>
              <Text style={styles.menuText}>帮助中心</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => handleNav('TestCollect')}>
              <Text style={styles.menuText}>测试采集</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.versionItem}>
              <Text style={styles.menuText}>版本</Text>
              <Text style={styles.menuValue}>1.0.21</Text>
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}
