import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, Image } from 'react-native';
import { useAppStore, getCollector } from '../useAppStore';

interface Props {
  navigation: any;
}

export default function SearchScreen({ navigation }: Props) {
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const { mediaList, searchMedia } = useAppStore();

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const collector = getCollector();
      await collector.collectByKeyword(keyword.trim());
      await searchMedia(keyword.trim());
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setSearching(false);
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => navigation.navigate('Detail', { id: item.id })}
    >
      {item.posterUrl && (
        <Image source={{ uri: item.posterUrl }} style={styles.poster} />
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.itemSubtitle}>
          {item.year} · {item.area || '未知'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="搜索电影、电视剧、综艺..."
          placeholderTextColor="#888"
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>{searching ? '...' : '搜索'}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={mediaList}
        keyExtractor={(item: any) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {keyword ? '未找到相关内容' : '输入关键词开始搜索'}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  searchBar: { flexDirection: 'row', padding: 15, paddingTop: 60, gap: 10 },
  input: { flex: 1, backgroundColor: '#1f1f1f', color: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, fontSize: 16 },
  searchButton: { backgroundColor: '#4a9eff', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 8 },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  item: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  poster: { width: 80, height: 110, borderRadius: 6, backgroundColor: '#222' },
  itemInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  itemTitle: { fontSize: 16, color: '#fff', fontWeight: '500', marginBottom: 6 },
  itemSubtitle: { fontSize: 13, color: '#888' },
  empty: { color: '#666', textAlign: 'center', marginTop: 100, fontSize: 15 },
});
