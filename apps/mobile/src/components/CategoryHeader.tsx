import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useThemeColors } from '../themes/useThemeColors';

const TYPES = [
  { key: 'HOME', label: '首页', route: 'Tabs' },
  { key: 'MOVIE', label: '电影', route: 'Movie' },
  { key: 'TV', label: '电视剧', route: 'TV' },
  { key: 'VARIETY', label: '综艺', route: 'Variety' },
  { key: 'ANIME', label: '动漫', route: 'Anime' },
  { key: 'DOCUMENTARY', label: '纪录片', route: 'Documentary' },
];

interface CategoryHeaderProps {
  activeType: string;
}

export default function CategoryHeader({ activeType }: CategoryHeaderProps) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();

  const styles = useMemo(() => StyleSheet.create({
    header: {
      paddingHorizontal: 15,
      paddingTop: 56,
      paddingBottom: 4,
    },
    appTitle: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.text,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      marginHorizontal: 15,
      marginTop: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
    },
    searchIcon: {
      fontSize: 16,
      marginRight: 8,
    },
    searchPlaceholder: {
      fontSize: 15,
      color: colors.disabledForeground,
    },
    typeTabs: {
      marginTop: 16,
      paddingHorizontal: 15,
    },
    typeTab: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginRight: 8,
      borderRadius: 8,
      backgroundColor: colors.card,
    },
    typeTabActive: {
      backgroundColor: colors.primary,
    },
    typeTabText: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontWeight: '500',
    },
    typeTabTextActive: {
      color: colors.primaryForeground,
    },
  }), [colors]);

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.appTitle}>Movie App</Text>
      </View>

      <TouchableOpacity style={styles.searchBar} onPress={() => navigation.navigate('搜索')}>
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchPlaceholder}>搜索电影、电视剧、综艺...</Text>
      </TouchableOpacity>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeTabs}>
        {TYPES.map(t => {
          const isActive = activeType === t.label;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.typeTab, isActive && styles.typeTabActive]}
              onPress={() => navigation.navigate(t.route)}
            >
              <Text style={[styles.typeTabText, isActive && styles.typeTabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
