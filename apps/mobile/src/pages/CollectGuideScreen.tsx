import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';

interface Props {
  navigation: any;
}

const CMS_GUIDES = [
  {
    name: '海洋CMS（HYCMS）',
    features: '支持标准 API，数据格式规范，推荐使用',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    config: '添加视频源时，API 地址填写上述格式的地址即可。采集速度建议设置为 2-3。',
  },
  {
    name: '苹果CMS8（MacCMS8）',
    features: '兼容性好，资源丰富',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    config: '苹果CMS8 和 海洋CMS API 格式类似。推荐使用 XML 格式以获得更好的兼容性。',
  },
  {
    name: '苹果CMS10（MacCMS10）',
    features: '最新版本，性能更好',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    config: '与 MacCMS8 类似，但数据结构略有不同。系统会自动适配。',
  },
];

const STEPS = [
  '打开「设置」页面',
  '进入「视频源管理」',
  '点击「添加视频源」，填写源信息',
  '返回设置页面，进入「采集配置」调整参数',
  '在视频源管理中点击「增量采集」或「全量采集」',
];

export default function CollectGuideScreen(_: Props) {
  const colors = useThemeColors();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { padding: 20, paddingTop: 60 },
    title: { fontSize: 24, fontWeight: 'bold', color: colors.text },
    content: { paddingHorizontal: 15, gap: 12, paddingBottom: 30 },
    card: { backgroundColor: colors.card, borderRadius: 12, padding: 16 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
    text: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
    featureText: { fontSize: 13, color: colors.primary, marginBottom: 8 },
    codeBox: { backgroundColor: colors.surfaceElevated, borderRadius: 6, padding: 10, marginBottom: 8 },
    codeText: { fontFamily: 'monospace', fontSize: 12, color: colors.mutedForeground },
    sectionTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, marginTop: 8, marginBottom: 4 },
    stepsCard: { backgroundColor: colors.card, borderRadius: 12, padding: 16, gap: 12 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stepBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    stepBadgeText: { color: colors.text, fontSize: 13, fontWeight: 'bold' },
    stepText: { fontSize: 14, color: colors.textSecondary, flex: 1 },
  }), [colors]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>采集教程</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>关于视频源</Text>
          <Text style={styles.text}>
            本应用支持多种 CMS 视频源。添加视频源后，通过采集功能获取视频数据。
          </Text>
        </View>

        <Text style={styles.sectionTitle}>支持的 CMS 类型</Text>
        {CMS_GUIDES.map((cms, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.cardTitle}>{cms.name}</Text>
            <Text style={styles.featureText}>{cms.features}</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeText}>{cms.apiFormat}</Text>
            </View>
            <Text style={styles.text}>{cms.config}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>通用配置步骤</Text>
        <View style={styles.stepsCard}>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
