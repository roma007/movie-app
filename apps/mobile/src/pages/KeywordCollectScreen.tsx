import { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useAppStore, getStore } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import PosterImage from '../components/PosterImage';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft, Check } from 'lucide-react-native';
import type { CollectPreviewItem } from '@movie-app/core';

interface Props {
  navigation: any;
  route?: { params?: { keyword?: string; relaxYear?: boolean } };
}

export default function KeywordCollectScreen({ navigation, route }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceBg = hexToRgba(colors.surface, cardOpacity / 100);
  const s = useScaledFontSize();

  const {
    previewResults, previewLoading,
    searchKeywordPreview, saveSelectedPreviewItems, clearPreviewResults, unhideMediaByGenres,
  } = useAppStore();

  const [keywordInput, setKeywordInput] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [relaxYear, setRelaxYear] = useState(false);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());

  const handleKeywordSearch = useCallback(async () => {
    const keyword = keywordInput.trim();
    if (!keyword) return;
    setHasSearched(true);
    setSelectedPreviewIds(new Set());
    try {
      await searchKeywordPreview(keyword, { unlimitedYear: relaxYear });
      setSelectedPreviewIds(new Set(getStore().getState().previewResults.map((r) => r.previewId)));
    } catch (err) {
      console.error('关键词搜索采集失败:', err);
    }
  }, [keywordInput, relaxYear, searchKeywordPreview]);

  useEffect(() => {
    const kw = route?.params?.keyword;
    const initialRelaxYear = route?.params?.relaxYear ?? false;
    if (initialRelaxYear) setRelaxYear(true);
    if (kw) {
      setKeywordInput(kw);
      // 依赖 relaxYear 尚未就绪，用 route 参数里带的值搜索
      searchKeywordPreview(kw, { unlimitedYear: initialRelaxYear }).then(() => {
        setSelectedPreviewIds(new Set(getStore().getState().previewResults.map((r) => r.previewId)));
      }).catch((err) => {
        console.error('关键词搜索采集失败:', err);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.keyword, route?.params?.relaxYear]);

  const handleTogglePreviewItem = useCallback((previewId: string) => {
    setSelectedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(previewId)) next.delete(previewId);
      else next.add(previewId);
      return next;
    });
  }, []);

  const isSelected = useCallback((previewId: string) => {
    return selectedPreviewIds.has(previewId);
  }, [selectedPreviewIds]);

  const handleSelectAllPreview = useCallback(() => {
    if (selectedPreviewIds.size === previewResults.length) {
      setSelectedPreviewIds(new Set());
    } else {
      setSelectedPreviewIds(new Set(previewResults.map((r) => r.previewId)));
    }
  }, [selectedPreviewIds, previewResults]);

  const isAllSelected = previewResults.length > 0 && selectedPreviewIds.size === previewResults.length;
  const selectedCount = selectedPreviewIds.size;

  const handleClose = useCallback(() => {
    clearPreviewResults();
    setHasSearched(false);
    setKeywordInput('');
    setSelectedPreviewIds(new Set());
    setRelaxYear(false);
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Home');
    }
  }, [clearPreviewResults, navigation]);

  const handleSavePreview = useCallback(async () => {
    const items = previewResults.filter((p) => selectedPreviewIds.has(p.previewId));
    if (items.length === 0) {
      Alert.alert('提示', '请至少选择一个视频');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveSelectedPreviewItems(items, { unlimitedYear: relaxYear });
      const count = result.saved;
      if (count > 0) {
        Alert.alert('采集完成', `成功采集 ${count} 部视频`);
        clearPreviewResults();
        setHasSearched(false);
        setKeywordInput('');
        setSelectedPreviewIds(new Set());
        setRelaxYear(false);
        if (result.hiddenItems.length > 0) {
          const titles = result.hiddenItems.map((h) => h.title);
          const titleText = titles.length > 8
            ? `${titles.slice(0, 8).join('、')}等${titles.length}部`
            : titles.join('、');
          const genres = [...new Set(result.hiddenItems.flatMap((h) => h.genres))];
          Alert.alert(
            '部分视频已被隐藏',
            `「${titleText}」视频名被隐藏，恢复显示「${genres.join('、')}」类视频后就可以找到。是否取消隐藏这些子类型？`,
            [
              { text: '取消', style: 'cancel' },
              {
                text: '取消隐藏',
                onPress: () => {
                  unhideMediaByGenres(genres)
                    .then((res) => {
                      if (res.unhidden > 0) {
                        Alert.alert('已恢复', `已取消隐藏「${genres.join('、')}」，恢复显示 ${res.unhidden} 部视频`);
                      }
                    })
                    .catch((err) => {
                      console.error('[COLLECT] 取消隐藏子类型失败:', err);
                      Alert.alert('操作失败', '取消隐藏失败，请重试');
                    });
                },
              },
            ]
          );
        }
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('Home');
        }
      } else {
        Alert.alert('采集失败', '请重试');
      }
    } catch (err: any) {
      Alert.alert('保存失败', err.message || '未知错误');
    } finally {
      setIsSaving(false);
    }
  }, [previewResults, selectedPreviewIds, saveSelectedPreviewItems, clearPreviewResults, relaxYear, navigation, unhideMediaByGenres]);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    navBack: { padding: 8, marginRight: 8 },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    navPlaceholder: { width: 40 },
    searchRow: { flexDirection: 'row', gap: 8 },
    optionRow: { flexDirection: 'row', gap: 16 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    switchLabel: { fontSize: s(13), color: colors.mutedForeground },
    previewLoading: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 40, gap: 8 },
    previewLoadingText: { color: colors.mutedForeground, fontSize: s(14) },
    previewEmpty: { color: colors.disabledForeground, textAlign: 'center', paddingVertical: 40, fontSize: s(15) },
    previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 },
    selectedCount: { color: colors.mutedForeground, fontSize: s(13) },
    previewList: { marginTop: 4 },
    previewItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.sm, gap: 12 },
    previewItemSelected: { backgroundColor: 'rgba(74,158,255,0.05)' },
    previewCheckbox: { width: 22, height: 22, borderRadius: radius.sm, backgroundColor: surfaceBg, borderWidth: 1, borderColor: colors.disabledForeground, justifyContent: 'center', alignItems: 'center' },
    previewCheckboxOn: { backgroundColor: colors.buttonPrimaryBg, borderColor: colors.buttonPrimaryBg },
    previewPoster: { width: 60, height: 88, borderRadius: radius.sm, backgroundColor: cardBg },
    previewItemInfo: { flex: 1 },
    previewItemTitle: { fontSize: s(15), color: colors.text, marginBottom: 2 },
    previewItemMeta: { fontSize: s(12), color: colors.mutedForeground, marginBottom: 1 },
    previewItemDetail: { fontSize: s(11), color: colors.disabledForeground },
    footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 15, paddingTop: 12, paddingBottom: 16 },
    footerButton: { flex: 1 },
  }), [colors, cardBg, surfaceBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button variant="icon" size="sm" style={styles.navBack} onPress={handleClose}>
              <ArrowLeft size={20} color={colors.text} />
            </Button>
            <Text style={styles.title}>关键词搜索采集</Text>
            <View style={styles.navPlaceholder} />
          </View>
        </View>

        <View style={{ paddingHorizontal: 15, gap: 12 }}>
          <View style={styles.searchRow}>
            <Input
              size="lg"
              style={{ flex: 1 }}
              placeholder="输入电影/电视剧名称..."
              value={keywordInput}
              onChangeText={setKeywordInput}
              onSubmitEditing={() => handleKeywordSearch()}
              returnKeyType="search"
            />
            <Button variant="primary" size="sm" onPress={() => handleKeywordSearch()} loading={previewLoading}>
              搜索
            </Button>
          </View>
          <View style={styles.optionRow}>
            <View style={styles.switchRow}>
              <Switch
                value={relaxYear}
                onValueChange={setRelaxYear}
                trackColor={{ false: colors.swiftTrack, true: colors.swiftActiveTrack }}
                thumbColor={relaxYear ? colors.swiftThumb : colors.disabledForeground}
              />
              <Text style={styles.switchLabel}>不限年份</Text>
            </View>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 15 }}>
          {previewLoading ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={styles.previewLoadingText}>搜索中...</Text>
            </View>
          ) : hasSearched && previewResults.length === 0 ? (
            <Text style={styles.previewEmpty}>未找到相关结果</Text>
          ) : previewResults.length > 0 ? (
            <>
              <View style={styles.previewHeader}>
                <Button variant="link" size="sm" onPress={handleSelectAllPreview}>
                  {isAllSelected ? '取消全选' : `全选 (${previewResults.length})`}
                </Button>
                <Text style={styles.selectedCount}>已选 {selectedCount} 项</Text>
              </View>
              {previewResults.map((item: CollectPreviewItem) => {
                const selected = isSelected(item.previewId);
                return (
                  <TouchableOpacity
                    key={item.previewId}
                    style={[styles.previewItem, selected && styles.previewItemSelected]}
                    onPress={() => handleTogglePreviewItem(item.previewId)}
                  >
                    <View style={[styles.previewCheckbox, selected && styles.previewCheckboxOn]}>
                      {selected && <Check size={14} color={colors.text} />}
                    </View>
                    {item.posterUrl && <PosterImage uri={item.posterUrl} style={styles.previewPoster} />}
                    <View style={styles.previewItemInfo}>
                      <Text style={styles.previewItemTitle} numberOfLines={1}>
                        {item.title} ({item.year})
                      </Text>
                      <Text style={styles.previewItemMeta} numberOfLines={1}>
                        {item.type} · {item.area} · {item.sourceName}
                      </Text>
                      {item.directors.length > 0 && (
                        <Text style={styles.previewItemDetail} numberOfLines={1}>
                          导演: {item.directors.join(', ')}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          ) : (
            <Text style={styles.previewEmpty}>输入关键词后点击搜索</Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button variant="secondary" size="md" style={styles.footerButton} onPress={handleClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="md"
            style={styles.footerButton}
            loading={isSaving}
            disabled={isSaving || previewLoading}
            onPress={handleSavePreview}
          >
            保存选中 ({selectedCount})
          </Button>
        </View>
      </View>
    </BlurredBackground>
  );
}