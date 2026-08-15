import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { ArrowLeft, Sparkles, ThumbsUp, ThumbsDown, Search, Eye, RotateCcw, RefreshCw } from 'lucide-react-native';
import { useAppStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import type { RecommendationOverview } from '@movie-app/core';

interface Props {
  navigation: any;
}

export default function RecommendationSettingsScreen({ navigation }: Props) {
  const { getRecommendationOverview, resetRecommendationLearning, flushRecommendationRecompute } = useAppStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const [overview, setOverview] = useState<RecommendationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const loadOverview = async () => {
    try {
      const data = await getRecommendationOverview();
      setOverview(data);
    } catch (err) {
      console.error('加载推荐偏好失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleReset = () => {
    Alert.alert(
      '从头学习',
      '将清空「越看越懂你」已学到的偏好，并从现在起重新学习。观看历史、收藏与续播进度记录都会保留，但重置前的观看、搜索与收藏不再参与推荐学习。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '从头学习',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await resetRecommendationLearning();
              setLoading(true);
              await loadOverview();
            } catch (err) {
              console.error('从头学习失败:', err);
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await flushRecommendationRecompute();
      await loadOverview();
    } catch (err) {
      console.error('重新计算失败:', err);
      setLoading(false);
    }
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { padding: 15 },
    card: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 15,
    },
    cardPadding: { padding: 15 },
    intro: {
      fontSize: s(13),
      color: colors.textSecondary,
      lineHeight: s(19),
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    statCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 12,
      borderRadius: radius.md,
      backgroundColor: hexToRgba(colors.cardAccent, cardOpacity / 100 * 0.35),
      flexGrow: 1,
      minWidth: '45%',
    },
    statValue: {
      fontSize: s(20),
      fontWeight: 'bold',
      color: colors.text,
    },
    statLabel: {
      fontSize: s(11),
      color: colors.mutedForeground,
      marginTop: 2,
    },
    sectionTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 10,
    },
    sectionTitleText: {
      fontSize: s(14),
      fontWeight: '600',
      color: colors.text,
    },
    topItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 9,
      paddingHorizontal: 10,
      borderRadius: radius.md,
    },
    topItemText: {
      fontSize: s(14),
      color: colors.text,
      flex: 1,
      marginRight: 8,
    },
    topItemScore: {
      fontSize: s(13),
      color: colors.mutedForeground,
    },
    emptyText: {
      fontSize: s(13),
      color: colors.mutedForeground,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.15),
    },
    chipText: {
      fontSize: s(13),
      color: colors.text,
    },
    loading: {
      paddingVertical: 40,
      alignItems: 'center',
    },
  }), [colors, cardBg, s, cardOpacity]);

  return (
    <BlurredBackground imageUrl={null}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
              <ArrowLeft size={20} color={colors.text} />
            </Button>
            <Text style={styles.title}>推荐偏好</Text>
            <View style={styles.placeholder} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={[styles.card, styles.cardPadding]}>
            <Text style={styles.intro}>
              「越看越懂你」会根据你的观看行为自动学习偏好：完播一部 +10、连续追多集 +5、收藏 +20、
              点开弃看 -10、展示多次未点开 -5、搜索命中 +3，并从经常「点开就弃」的子分类中降低推荐权重。
              所有信号都来自应用自身数据，可随时「从头学习」。
            </Text>
          </View>

          {loading || !overview ? (
            <View style={styles.card}>
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.card, styles.cardPadding]}>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <ThumbsUp size={18} color={colors.success} />
                    <View>
                      <Text style={styles.statValue}>{overview.completedCount}</Text>
                      <Text style={styles.statLabel}>完播影片</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <ThumbsDown size={18} color={colors.error} />
                    <View>
                      <Text style={styles.statValue}>{overview.giveUpCount}</Text>
                      <Text style={styles.statLabel}>点开弃看</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <Search size={18} color={colors.mutedForeground} />
                    <View>
                      <Text style={styles.statValue}>{overview.searchKeywordCount}</Text>
                      <Text style={styles.statLabel}>搜索关键词</Text>
                    </View>
                  </View>
                  <View style={styles.statCard}>
                    <Eye size={18} color={colors.mutedForeground} />
                    <View>
                      <Text style={styles.statValue}>{overview.impressionMediaCount}</Text>
                      <Text style={styles.statLabel}>展示追踪</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={[styles.card, styles.cardPadding]}>
                <View style={styles.sectionTitle}>
                  <Sparkles size={16} color={colors.mutedForeground} />
                  <Text style={styles.sectionTitleText}>当前高评分（为你推荐靠前）</Text>
                </View>
                {overview.topMedia.length === 0 ? (
                  <Text style={styles.emptyText}>
                    暂无学习数据。多看一些影片后，这里会显示你的高分偏好。
                  </Text>
                ) : (
                  overview.topMedia.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={styles.topItem}
                      onPress={() => navigation.navigate('Detail', { id: m.id })}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.topItemText} numberOfLines={1}>{m.title}</Text>
                      <Text style={styles.topItemScore}>+{m.score}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <View style={[styles.card, styles.cardPadding]}>
                <View style={styles.sectionTitle}>
                  <ThumbsDown size={16} color={colors.mutedForeground} />
                  <Text style={styles.sectionTitleText}>降权子分类（点开即弃比例过高）</Text>
                </View>
                {overview.penalizedSubtypes.length === 0 ? (
                  <Text style={styles.emptyText}>
                    暂无降权子分类。当某个子分类的弃看样本足够多时，会自动降低其推荐权重。
                  </Text>
                ) : (
                  <View style={styles.chipRow}>
                    {overview.penalizedSubtypes.map((g) => (
                      <View key={g} style={styles.chip}>
                        <Text style={styles.chipText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}

          <View style={[styles.card, styles.cardPadding]}>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              leftIcon={<RefreshCw size={16} color={colors.text} />}
              onPress={handleRefresh}
            >
              重新计算推荐分
            </Button>
            <View style={{ height: 10 }} />
            <Button
              variant="destructive"
              size="lg"
              fullWidth
              loading={resetting}
              leftIcon={<RotateCcw size={16} color={colors.error} />}
              onPress={handleReset}
            >
              {resetting ? '学习中...' : '从头学习'}
            </Button>
          </View>
        </View>
      </ScrollView>
    </BlurredBackground>
  );
}
