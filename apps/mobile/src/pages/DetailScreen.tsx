import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAppStore } from '../useAppStore';

interface Props {
  route: any;
  navigation: any;
}

export default function DetailScreen({ route }: Props) {
  const { id } = route.params;
  const { currentMedia, episodes, seasons, isLoading, loadMediaDetail, loadEpisodes, loadSeasons } = useAppStore();
  const [currentSeason, setCurrentSeason] = useState(1);

  useEffect(() => {
    loadMediaDetail(id);
    loadSeasons(id);
    loadEpisodes(id, 1);
  }, [id]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.includes(currentSeason)) {
      setCurrentSeason(seasons[0]);
    }
  }, [seasons]);

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
          {episodes.map((ep: any) => (
            <TouchableOpacity key={ep.id} style={styles.episodeButton}>
              <Text style={styles.episodeText}>
                {ep.title || `第${ep.episodeNumber}集`}
              </Text>
            </TouchableOpacity>
          ))}
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
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 50 },
});
