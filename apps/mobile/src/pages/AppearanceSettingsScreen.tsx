import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';
import { radius } from '../themes/radiusTokens';
import type { ColorMode } from '../themes/types';

interface Props {
  navigation: any;
}

const CHECK_COLOR = '#22c55e';

const COLOR_MODE_OPTIONS: { mode: ColorMode; label: string; desc?: string }[] = [
  { mode: 'system', label: '跟随系统', desc: '开启后，应用将跟随系统切换您偏好的颜色模式。' },
  { mode: 'dark', label: '深色模式' },
  { mode: 'light', label: '浅色模式' },
];

const FONT_SIZE_PRESETS: { scale: number; label: string }[] = [
  { scale: 0.85, label: '小' },
  { scale: 1.0, label: '默认' },
  { scale: 1.15, label: '大' },
  { scale: 1.3, label: '特大' },
];

export default function AppearanceSettingsScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const setCardOpacity = useThemeStore((s) => s.setCardOpacity);
  const blurIntensity = useThemeStore((s) => s.blurIntensity);
  const setBlurIntensity = useThemeStore((s) => s.setBlurIntensity);
  const imageBlur = useThemeStore((s) => s.imageBlur);
  const setImageBlur = useThemeStore((s) => s.setImageBlur);
  const imageScale = useThemeStore((s) => s.imageScale);
  const setImageScale = useThemeStore((s) => s.setImageScale);
  const fontSizeScale = useThemeStore((s) => s.fontSizeScale);
  const setFontSizeScale = useThemeStore((s) => s.setFontSizeScale);
  const colorMode = useThemeStore((s) => s.colorMode);
  const setColorMode = useThemeStore((s) => s.setColorMode);

  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { padding: 15 },
    cardTitle: { fontSize: s(15), fontWeight: '600', color: colors.text, paddingHorizontal: 15, paddingTop: 15, paddingBottom: 10 },
    card: {
      backgroundColor: cardBg,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: 20,
    },
    row: {
      paddingVertical: 18,
      paddingHorizontal: 15,
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: hexToRgba(colors.disabledForeground, 0.15),
    },
    rowLeft: { flex: 1, paddingRight: 12 },
    rowLabel: { fontSize: s(16), color: colors.text, fontWeight: '500' },
    rowDesc: { fontSize: s(13), color: colors.mutedForeground, marginTop: 4 },
    radioWrap: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioBorder: {
      borderWidth: 2,
      borderColor: colors.disabledForeground,
    },
    radioActive: {
      backgroundColor: CHECK_COLOR,
    },

    compactSliderLabelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingTop: 14,
      paddingBottom: 8,
    },
    compactSliderLabel: {
      fontSize: s(14),
      color: colors.text,
      fontWeight: '500',
    },
    compactSliderValue: {
      fontSize: s(14),
      color: colors.mutedForeground,
      fontWeight: '600',
    },
    compactSliderTrack: {
      paddingHorizontal: 15,
      paddingBottom: 14,
    },
    compactDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: hexToRgba(colors.disabledForeground, 0.15),
      marginHorizontal: 15,
    },
    compactFontRow: {
      paddingHorizontal: 15,
      paddingVertical: 14,
    },
    compactFontLabel: {
      fontSize: s(14),
      color: colors.text,
      fontWeight: '500',
      marginBottom: 12,
    },
    compactFontButtons: {
      flexDirection: 'row',
      gap: 10,
    },
    compactFontBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.md,
    },
  }), [colors, cardBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
              <ArrowLeft size={20} color={colors.text} />
            </Button>
            <Text style={styles.title}>外观设置</Text>
            <View style={styles.placeholder} />
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>颜色模式</Text>
            {COLOR_MODE_OPTIONS.map((opt, idx) => {
              const active = colorMode === opt.mode;
              const isLast = idx === COLOR_MODE_OPTIONS.length - 1;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.row, !isLast && styles.rowBorder]}
                  onPress={() => setColorMode(opt.mode)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowLabel}>{opt.label}</Text>
                    {opt.desc ? <Text style={styles.rowDesc}>{opt.desc}</Text> : null}
                  </View>
                  <View
                    style={[
                      styles.radioWrap,
                      active ? styles.radioActive : styles.radioBorder,
                    ]}
                  >
                    {active ? <Check size={14} color={colors.text} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>视觉与透明度</Text>
            <View style={styles.compactSliderLabelRow}>
              <Text style={styles.compactSliderLabel}>磨砂强度</Text>
              <Text style={styles.compactSliderValue}>{blurIntensity}</Text>
            </View>
            <View style={styles.compactSliderTrack}>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={5}
                value={blurIntensity}
                onValueChange={setBlurIntensity}
                minimumTrackTintColor={colors.mutedForeground}
                maximumTrackTintColor={colors.trackBg}
                thumbTintColor={colors.text}
              />
            </View>
            <View style={styles.compactDivider} />

            <View style={styles.compactSliderLabelRow}>
              <Text style={styles.compactSliderLabel}>背景图模糊</Text>
              <Text style={styles.compactSliderValue}>{imageBlur}</Text>
            </View>
            <View style={styles.compactSliderTrack}>
              <Slider
                minimumValue={0}
                maximumValue={100}
                step={5}
                value={imageBlur}
                onValueChange={setImageBlur}
                minimumTrackTintColor={colors.mutedForeground}
                maximumTrackTintColor={colors.trackBg}
                thumbTintColor={colors.text}
              />
            </View>
            <View style={styles.compactDivider} />

            <View style={styles.compactSliderLabelRow}>
              <Text style={styles.compactSliderLabel}>背景图缩放</Text>
              <Text style={styles.compactSliderValue}>{imageScale}x</Text>
            </View>
            <View style={styles.compactSliderTrack}>
              <Slider
                minimumValue={1}
                maximumValue={50}
                step={1}
                value={imageScale}
                onValueChange={setImageScale}
                minimumTrackTintColor={colors.mutedForeground}
                maximumTrackTintColor={colors.trackBg}
                thumbTintColor={colors.text}
              />
            </View>
            <View style={styles.compactDivider} />

            <View style={styles.compactSliderLabelRow}>
              <Text style={styles.compactSliderLabel}>卡片透明度</Text>
              <Text style={styles.compactSliderValue}>{cardOpacity}%</Text>
            </View>
            <View style={styles.compactSliderTrack}>
              <Slider
                minimumValue={10}
                maximumValue={100}
                step={1}
                value={cardOpacity}
                onValueChange={setCardOpacity}
                minimumTrackTintColor={colors.mutedForeground}
                maximumTrackTintColor={colors.trackBg}
                thumbTintColor={colors.text}
              />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>字体大小</Text>
            <View style={styles.compactFontRow}>
              <View style={styles.compactFontButtons}>
                {FONT_SIZE_PRESETS.map((preset) => (
                  <Button
                    key={preset.scale}
                    variant="secondary"
                    size="sm"
                    active={fontSizeScale === preset.scale}
                    style={styles.compactFontBtn}
                    onPress={() => setFontSizeScale(preset.scale)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </BlurredBackground>
  );
}
