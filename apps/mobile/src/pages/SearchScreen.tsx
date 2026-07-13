import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, FlatList, TouchableOpacity, Image } from 'react-native';
import { useAppStore, getCollector, getProvider } from '../useAppStore';

interface Props {
  navigation: any;
}

export default function SearchScreen({ navigation }: Props) {
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);
  const { mediaList, searchMedia } = useAppStore();

  useEffect(() => {
    const provider = getProvider();
    provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    provider.getHotSearches(10).then(setHotSearches).catch(() => {});
  }, []);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const provider = getProvider();
      await provider.addSearchHistory(keyword.trim());
      const collector = getCollector();
      await collector.collectByKeyword(keyword.trim());
      await searchMedia(keyword.trim());
      provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
      provider.getHotSearches(10).then(setHotSearches).catch(() => {});
    } catch (err) {
      console.error('搜索失败:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleHistoryClick = async (kw: string) => {
    setKeyword(kw);
    await handleSearch();
  };

  const handleClearHistory = async () => {
    const provider = getProvider();
    await provider.clearSearchHistory();
    setSearchHistory([]);
  };

  const handleDeleteHistory = async (kw: string) => {
    const provider = getProvider();
    await provider.deleteSearchHistory(kw);
    setSearchHistory(prev => prev.filter(h => h.keyword !== kw));
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

      {mediaList.length > 0 ? (
        <FlatList
          data={mediaList}
          keyExtractor={(item: any) => item.id}
          renderItem={renderItem}
        />
      ) : (
        <View style={styles.historyContainer}>
          {searchHistory.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>搜索历史</Text>
                <TouchableOpacity onPress={handleClearHistory}>
                  <Text style={styles.clearButton}>清空</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.tagRow}>
                {searchHistory.map((item) => (
                  <View key={item.keyword} style={styles.tagContainer}>
                    <TouchableOpacity
                      style={styles.tag}
                      onPress={() => handleHistoryClick(item.keyword)}
                    >
                      <Text style={styles.tagText}>{item.keyword}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteHistory(item.keyword)}>
                      <Text style={styles.deleteIcon}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {hotSearches.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>热门搜索</Text>
              <View style={styles.tagRow}>
                {hotSearches.map((item, index) => (
                  <TouchableOpacity
                    key={item.keyword}
                    style={styles.hotTag}
                    onPress={() => handleHistoryClick(item.keyword)}
                  >
                    <Text style={styles.hotIndex}>{index + 1}</Text>
                    <Text style={styles.tagText}>{item.keyword}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {mediaList.length === 0 && keyword && !searching && (
            <Text style={styles.empty}>未找到相关内容</Text>
          )}
        </View>
      )}
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
  empty: { color: '#666', textAlign: 'center', marginTop: 50, fontSize: 15 },
  historyContainer: { padding: 15 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 14, color: '#888', fontWeight: '500' },
  clearButton: { fontSize: 13, color: '#4a9eff' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f1f1f', borderRadius: 6, overflow: 'hidden' },
  tag: { paddingHorizontal: 12, paddingVertical: 8 },
  tagText: { fontSize: 14, color: '#ccc' },
  deleteIcon: { fontSize: 14, color: '#666', paddingRight: 8 },
  hotTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2a1f1f', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  hotIndex: { fontSize: 12, color: '#ff6b6b', marginRight: 6 },
});
