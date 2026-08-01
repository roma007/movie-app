import { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Search } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { Input } from './ui/Input';
import { radius } from '../themes/radiusTokens';
import { hexToRgba } from '../themes/colorUtils';
import { useThemeStore } from '../themes/store';

interface SearchBarProps {
  placeholder?: string;
}

export default function SearchBar({ placeholder = '搜索电影、电视剧、综艺...' }: SearchBarProps) {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const [keyword, setKeyword] = useState('');

  const handleSearch = () => {
    const kw = keyword.trim();
    if (!kw) return;
    navigation.navigate('Search', { keyword: kw });
    setKeyword('');
  };

  return (
    <View style={[styles.container, { backgroundColor: surfaceBg }]}>
      <Input
        style={styles.input}
        placeholder={placeholder}
        value={keyword}
        onChangeText={setKeyword}
        onSubmitEditing={handleSearch}
        returnKeyType="search"
      />
      <TouchableOpacity style={[styles.searchButton, { backgroundColor: colors.mutedForeground }]} onPress={handleSearch}>
        <Search size={16} color={colors.background} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingLeft: 4,
    paddingRight: 4,
    borderRadius: radius.md,
    gap: 6,
  },
  input: {
    flex: 1,
    borderWidth: 0,
  },
  searchButton: {
    padding: 8,
    borderRadius: radius.sm,
  },
});
