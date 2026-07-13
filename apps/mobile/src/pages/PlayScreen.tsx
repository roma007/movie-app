import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { getProvider } from '../init';
import { useAppStore } from '../useAppStore';
import { ArrowLeft } from 'lucide-react-native';
import type { PlaySource } from '@movie-app/core';

interface Props {
  route: any;
  navigation: any;
}

export default function PlayScreen({ route, navigation }: Props) {
  const { episodeId, title } = route.params;
  const { saveWatchProgress } = useAppStore();
  const videoRef = useRef<Video>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [playSources, setPlaySources] = useState<PlaySource[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [failCount, setFailCount] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!episodeId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const provider = getProvider();
        const episode = await provider.getEpisodeById(episodeId);
        if (cancelled || !episode) return;
        const [media, sources] = await Promise.all([
          provider.getMediaById(episode.mediaId),
          provider.getPlaySourcesByEpisodeId(episode.id),
        ]);
        if (cancelled) return;
        setPlaySources(sources);
        if (sources.length > 0) {
          setVideoUrl(sources[0].url);
        } else {
          setError('无可播放的线路');
        }
      } catch (err) {
        setError('加载失败');
      } finally {
        setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [episodeId]);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    if (duration > 0) {
      saveWatchProgress(episodeId || '', null, Math.floor(currentTime), Math.floor(duration));
    }
  };

  const handleSourceFail = async (sourceId: string) => {
    const provider = getProvider();
    await provider.reportPlaySourceFail(sourceId);

    const newFailCount = (failCount[sourceId] || 0) + 1;
    setFailCount(prev => ({ ...prev, [sourceId]: newFailCount }));

    const activeSources = playSources.filter(s => s.isActive !== false);
    const currentIdx = activeSources.findIndex(s => s.id === sourceId);
    const nextIdx = currentIdx + 1;

    if (nextIdx < activeSources.length) {
      setError(`线路 ${currentIdx + 1} 失败，正在尝试线路 ${nextIdx + 1}...`);
      setTimeout(() => {
        setActiveIdx(nextIdx);
        setVideoUrl(activeSources[nextIdx].url);
        setIsLoading(true);
        setError(null);
      }, 1500);
    } else {
      setError('所有线路均失败，请稍后重试');
    }
  };

  const handleSourceChange = (idx: number) => {
    setActiveIdx(idx);
    setVideoUrl(playSources[idx].url);
    setIsLoading(true);
    setError(null);
  };

  const handleRetry = () => {
    setFailCount({});
    setActiveIdx(0);
    setVideoUrl(playSources[0]?.url || '');
    setIsLoading(true);
    setError(null);
  };

  const activeSources = playSources.filter(s => s.isActive !== false);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || '正在播放'}</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.videoContainer}>
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.loadingText}>
              加载中...（线路 {activeIdx + 1}/{activeSources.length}）
            </Text>
          </View>
        )}
        {error && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorText}>{error}</Text>
            {activeSources.length > 0 && (
              <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>重试</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {videoUrl && !error && (
          <Video
            ref={videoRef}
            style={styles.video}
            source={{ uri: videoUrl }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            isLooping={false}
            onLoadStart={() => setIsLoading(true)}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              const currentSource = activeSources[activeIdx];
              if (currentSource) {
                handleSourceFail(currentSource.id);
              } else {
                setError('视频加载失败');
              }
            }}
            onPlaybackStatusUpdate={(status) => {
              if (status.isLoaded && status.positionMillis !== undefined && status.durationMillis !== undefined) {
                handleTimeUpdate(status.positionMillis / 1000, status.durationMillis / 1000);
              }
            }}
          />
        )}
      </View>

      {playSources.length > 1 && (
        <View style={styles.sourcesContainer}>
          <Text style={styles.sourcesLabel}>播放线路（当前：{playSources[activeIdx]?.sourceName || `线路${activeIdx + 1}`}）</Text>
          <View style={styles.sourcesRow}>
            {playSources.map((s, i) => (
              <TouchableOpacity
                key={s.id}
                style={[
                  styles.sourceButton,
                  i === activeIdx && styles.sourceButtonActive,
                  s.isActive === false && styles.sourceButtonDisabled,
                ]}
                onPress={() => s.isActive !== false && handleSourceChange(i)}
                disabled={s.isActive === false}
              >
                <Text style={[
                  styles.sourceText,
                  i === activeIdx && styles.sourceTextActive,
                  s.isActive === false && styles.sourceTextDisabled,
                ]}>
                  {s.sourceName || `线路${i + 1}`}
                  {s.isActive === false && ' (不可用)'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 15, paddingTop: 50, backgroundColor: '#111' },
  backButton: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#fff', marginLeft: 8 },
  placeholder: { width: 40 },
  videoContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
  loadingOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1 },
  loadingText: { color: '#ccc', fontSize: 14, marginTop: 8 },
  errorOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1, padding: 20 },
  errorText: { color: '#ff6b6b', fontSize: 16, textAlign: 'center' },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#4a9eff', borderRadius: 8, marginTop: 16 },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sourcesContainer: { padding: 15, backgroundColor: '#111' },
  sourcesLabel: { fontSize: 14, color: '#888', marginBottom: 10 },
  sourcesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sourceButton: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#222', borderRadius: 6 },
  sourceButtonActive: { backgroundColor: '#4a9eff' },
  sourceButtonDisabled: { backgroundColor: '#222', opacity: 0.5 },
  sourceText: { fontSize: 13, color: '#ccc' },
  sourceTextActive: { color: '#fff' },
  sourceTextDisabled: { color: '#666' },
});
