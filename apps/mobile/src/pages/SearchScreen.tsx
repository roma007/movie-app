import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppStore, getCollector, getProvider, getStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import PosterImage from '../components/PosterImage';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft, Mic } from 'lucide-react-native';
import { getVoiceControlSystem } from '@movie-app/core';
import { openMediaPlay } from '../utils/openMediaPlay';

interface Props {
  navigation: any;
  route?: { params?: { keyword?: string } };
}

export default function SearchScreen({ navigation, route }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHistory, setSearchHistory] = useState<{ keyword: string; count: number }[]>([]);
  const [hotSearches, setHotSearches] = useState<{ keyword: string; count: number }[]>([]);
  const { mediaList, searchMedia } = useAppStore();
  const searchIdRef = useRef(0);
  const voiceControl = getVoiceControlSystem();
  const [isVoiceSearching, setIsVoiceSearching] = useState(false);

  const refreshHistory = () => {
    const provider = getProvider();
    provider.getSearchHistory(10).then(setSearchHistory).catch(() => {});
    provider.getHotSearches(10).then(setHotSearches).catch(() => {});
  };

  const runSearch = async (kw: string) => {
    const id = ++searchIdRef.current;
    setSearching(true);
    try {
      const provider = getProvider();
      await provider.addSearchHistory(kw);
      const collector = getCollector();
      await collector.collectByKeyword(kw);
      if (id !== searchIdRef.current) return;
      await searchMedia(kw);
      if (id !== searchIdRef.current) return;
      getStore().getState().scheduleRecommendationRecompute();
      refreshHistory();
    } catch (err) {
      if (id === searchIdRef.current) console.error('搜索失败:', err);
    } finally {
      if (id === searchIdRef.current) setSearching(false);
    }
  };

  useEffect(() => {
    const kw = route?.params?.keyword;
    if (kw) {
      setKeyword(kw);
      getProvider().addSearchHistory(kw).catch(() => {});
      runSearch(kw);
    }
  }, [route?.params?.keyword]);

  // 语音搜索功能
  useEffect(() => {
    if (!voiceControl) return;

    const voiceControlConfig = voiceControl.getConfig();
    if (!voiceControlConfig.enabled) return;

    // 注册搜索命令
    voiceControl.registerCommands([
      {
        id: 'search',
        name: '搜索',
        description: '搜索内容',
        aliases: ['搜索', '找', '查找'],
        category: 'search',
        parameters: [
          {
            name: 'keyword',
            type: 'string',
            required: true,
            description: '搜索关键词',
          },
        ],
        execute: async (params) => {
          const searchKeyword = params?.keyword;
          if (searchKeyword) {
            setKeyword(searchKeyword);
            runSearch(searchKeyword);
          }
        },
      },
      {
        id: 'search_movie',
        name: '搜索电影',
        description: '搜索电影',
        aliases: ['搜索电影', '找电影', '查找电影'],
        category: 'search',
        parameters: [
          {
            name: 'keyword',
            type: 'string',
            required: true,
            description: '电影名称',
          },
        ],
        execute: async (params) => {
          const searchKeyword = params?.keyword;
          if (searchKeyword) {
            setKeyword(searchKeyword);
            runSearch(searchKeyword);
          }
        },
      },
      {
        id: 'search_tv',
        name: '搜索电视剧',
        description: '搜索电视剧',
        aliases: ['搜索电视剧', '找电视剧', '查找电视剧', '搜索剧'],
        category: 'search',
        parameters: [
          {
            name: 'keyword',
            type: 'string',
            required: true,
            description: '电视剧名称',
          },
        ],
        execute: async (params) => {
          const searchKeyword = params?.keyword;
          if (searchKeyword) {
            setKeyword(searchKeyword);
            runSearch(searchKeyword);
          }
        },
      },
    ]);

    return () => {
      // 清理命令
    };
  }, [voiceControl]);

  const handleVoiceSearch = () => {
    if (isVoiceSearching) {
      voiceControl?.stop();
      setIsVoiceSearching(false);
    } else {
      setIsVoiceSearching(true);
      voiceControl?.triggerVoiceRecognition();
    }
  };

  const handleSearch = () => {
    const kw = keyword.trim();
    if (!kw) return;
    runSearch(kw);
  };

  const handleHistoryClick = (kw: string) => {
    setKeyword(kw);
    runSearch(kw);
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
      onPress={() => openMediaPlay(navigation, item)}
    >
      {item.posterUrl && (
        <PosterImage uri={item.posterUrl} style={styles.poster} />
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.itemSubtitle}>
          {item.year} · {item.area || '未知'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    searchBar: { flexDirection: 'row', padding: 15, paddingTop: 60, gap: 10 },
    item: { flexDirection: 'row', padding: 15 },
    poster: { width: 80, height: 110, borderRadius: radius.sm, backgroundColor: cardBg },
    itemInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
    itemTitle: { fontSize: s(16), color: colors.text, fontWeight: '500', marginBottom: 6 },
    itemSubtitle: { fontSize: s(13), color: colors.mutedForeground },
    empty: { color: colors.disabledForeground, textAlign: 'center', marginTop: 50, fontSize: s(15) },
    historyContainer: { padding: 15 },
    section: { marginBottom: 20 },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    sectionTitle: { fontSize: s(14), color: colors.mutedForeground, fontWeight: '500' },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tagContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: surfaceBg, borderRadius: radius.sm, overflow: 'hidden' },
    tag: { paddingHorizontal: 12, paddingVertical: 8 },
    tagText: { fontSize: s(14), color: colors.textSecondary },
    deleteIcon: { fontSize: s(14), color: colors.disabledForeground, paddingRight: 8 },
    hotTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: surfaceBg, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
    hotIndex: { fontSize: s(12), color: colors.error, marginRight: 6 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
    loadingText: { fontSize: s(14), color: colors.mutedForeground, marginTop: 10 },
  }), [colors, surfaceBg, cardBg, s]);

  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const first = mediaList[0];
    if (!first?.posterUrl) {
      setBgImageUrl(null);
      return;
    }
    setBgImageUrl(first.posterUrl);
  }, [mediaList]);

  return (
    <BlurredBackground imageUrl={bgImageUrl}>
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Button variant="icon" size="sm" onPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.navigate('Home');
          }
        }}>
          <ArrowLeft size={20} color={colors.text} />
        </Button>
        <Input
          size="lg"
          style={{ flex: 1 }}
          placeholder="搜索电影、电视剧、综艺..."
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {voiceControl?.getConfig().enabled && (
          <Button 
            variant="icon" 
            size="sm" 
            onPress={handleVoiceSearch}
          >
            <Mic size={20} color={colors.text} />
          </Button>
        )}
        <Button variant="primary" size="md" onPress={handleSearch}>
          搜索
        </Button>
      </View>

      {searching && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.mutedForeground} />
          <Text style={styles.loadingText}>搜索中...</Text>
        </View>
      )}

      {!searching && mediaList.length > 0 ? (
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
                <Button variant="link" size="sm" onPress={handleClearHistory}>
                  清空
                </Button>
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
                    <Button variant="ghost" size="sm" onPress={() => handleDeleteHistory(item.keyword)}>
                      <Text style={styles.deleteIcon}>×</Text>
                    </Button>
                  </View>
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
    </BlurredBackground>
  );
}
