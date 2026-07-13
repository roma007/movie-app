import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';
import { getProvider } from '../init';
import { VideoDurationService } from '@movie-app/core';
import type { Episode } from '@movie-app/core';

interface Props {
  route: any;
  navigation: any;
}

export default function DetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { currentMedia, episodes, seasons, isLoading, loadMediaDetail, loadEpisodes, loadSeasons } = useAppStore();
  const [currentSeason, setCurrentSeason] = useState(1);
  const [episodeDurations, setEpisodeDurations] = useState<Record<string, number | null>>({});

  useEffect(() => {
    loadMediaDetail(id);
    loadSeasons(id);
  }, [id]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

  useEffect(() => {
    if (!id || currentSeason === 0) return;
    loadEpisodes(id, currentSeason);
  }, [id, currentSeason]);

  useEffect(() => {
    if (episodes.length === 0) return;
    const durationService = new VideoDurationService();
    const provider = getProvider();
    const CONCURRENCY_LIMIT = 3;

    const fetchDuration = async (ep: Episode) => {
      try {
        const sources = await provider.getPlaySourcesByEpisodeId(ep.id);
        const m3u8Source = sources.find(s => s.url.endsWith('.m3u8') || s.url.toLowerCase().includes('m3u8'));
        if (m3u8Source) {
          const duration = await durationService.getDurationFromM3U8(m3u8Source.url);
          setEpisodeDurations(prev => ({ ...prev, [ep.id]: duration }));
        }
      } catch {
        setEpisodeDurations(prev => ({ ...prev, [ep.id]: null }));
      }
    };

    const runInBatches = async () => {
      for (let i = 0; i < episodes.length; i += CONCURRENCY_LIMIT) {
        const batch = episodes.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(batch.map(fetchDuration));
      }
    };

    runInBatches();
  }, [episodes]);

  const handleSeasonChange = (season: number) => {
    setCurrentSeason(season);
    loadEpisodes(id, season);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!currentMedia) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>加载失败</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        {currentMedia.posterUrl && (
          <Image source={{ uri: currentMedia.posterUrl }} style={styles.poster} />
        )}
        <View style={styles.info}>
          <Text style={styles.title}>{currentMedia.title}</Text>
          <Text style={styles.subtitle}>
            {currentMedia.year} · {currentMedia.area || '未知'}
          </Text>
          <View style={styles.genreRow}>
            {currentMedia.genres.slice(0, 3).map((g: string, i: number) => (
              <Text key={i} style={styles.genre}>{g}</Text>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>简介</Text>
        <Text style={styles.description}>{currentMedia.description || '暂无简介'}</Text>
      </View>

      {currentMedia.directors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>导演</Text>
          <Text style={styles.text}>{currentMedia.directors.join(' / ')}</Text>
        </View>
      )}

      {currentMedia.actors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>演员</Text>
          <Text style={styles.text}>{currentMedia.actors.join(' / ')}</Text>
        </View>
      )}

      {seasons.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>季数</Text>
          <View style={styles.seasonRow}>
            {seasons.map((s: number) => (
              <TouchableOpacity
                key={s}
                style={[styles.seasonButton, currentSeason === s && styles.seasonButtonActive]}
                onPress={() => handleSeasonChange(s)}
              >
                <Text style={[styles.seasonText, currentSeason === s && styles.seasonTextActive]}>
                  第{s}季
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>剧集 ({episodes.length}集)</Text>
        <View style={styles.episodeGrid}>
          {episodes.map((ep: any) => {
            const duration = episodeDurations[ep.id];
            return (
              <TouchableOpacity
                key={ep.id}
                style={styles.episodeButton}
                onPress={() => navigation.navigate('Play', { episodeId: ep.id, title: currentMedia.title + (ep.title ? ` · ${ep.title}` : ` · 第${ep.episodeNumber}集`) })}
              >
                <Text style={styles.episodeText}>
                  {ep.title || `第${ep.episodeNumber}集`}
                </Text>
                {duration !== null && (
                  <Text style={styles.episodeDuration}>
                    {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  loadingContainer: { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', padding: 20, paddingTop: 60 },
  poster: { width: 120, height: 170, borderRadius: 8, backgroundColor: '#222' },
  info: { flex: 1, marginLeft: 15, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#aaa', marginBottom: 10 },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genre: { fontSize: 12, color: '#4a9eff', backgroundColor: 'rgba(74, 158, 255, 0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  section: { padding: 20, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 10 },
  description: { fontSize: 14, color: '#bbb', lineHeight: 22 },
  text: { fontSize: 14, color: '#bbb' },
  seasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  seasonButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: '#333' },
  seasonButtonActive: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  seasonText: { color: '#ccc', fontSize: 14 },
  seasonTextActive: { color: '#fff' },
  episodeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  episodeButton: { width: '22%', paddingVertical: 10, backgroundColor: '#1f1f1f', borderRadius: 6, alignItems: 'center' },
  episodeText: { color: '#ccc', fontSize: 13 },
  episodeDuration: { color: '#666', fontSize: 11, marginTop: 4 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 50 },
});
