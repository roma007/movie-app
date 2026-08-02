import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { radius } from '../themes/radiusTokens';
import BlurredBackground from '../components/BlurredBackground';
import { Button } from '../components/ui/Button';

interface Props {
  navigation: any;
}

const CMS_REFS = [
  {
    name: '海洋CMS（HYCMS）',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    tip: '最常用，稳定性好，推荐优先使用',
  },
  {
    name: '苹果CMS8（MacCMS8）',
    apiFormat: 'http://你的域名/index.php/api.php/provide/vod/at/xml/',
    tip: '兼容性好，建议升级到 MacCMS10',
  },
  {
    name: '苹果CMS10（MacCMS10）',
    apiFormat: 'http://你的域名/index.php/api.php/provide/vod/at/xml/',
    tip: '最主流，功能完善，系统自动适配',
  },
];

const MANUAL_CONFIG_STEPS = [
  '打开「设置」页面，进入「视频源管理」',
  '点击「手动添加」，填写编码、名称、API 地址、速率限制',
  '保存后视频源出现在列表中',
  '点击「检测」确认源可用，用开关启用/禁用',
];

const AI_IMPORT_STEPS = [
  '进入「视频源管理」，点击「AI 导入」',
  '复制提示词发给 AI 助手（如 ChatGPT、Claude）',
  '将 AI 返回的数据粘贴进来，点击「解析并预览」',
  '确认预览结果（重复源自动跳过），点击「导入」',
];

const FULL_COLLECT_POINTS = [
  { label: '适用场景', text: '首次添加视频源，或需要建立完整片库' },
  { label: '操作方式', text: '视频源管理中对对应源点击「全量采集」' },
  { label: '参数调整', text: '「采集配置」中可设置全量采集最大页数' },
  { label: '特点', text: '采集全部数据，耗时较长，建议初期执行一次' },
];

const INCREMENTAL_COLLECT_POINTS = [
  { label: '适用场景', text: '日常追新，只采集新增的视频内容' },
  { label: '操作方式', text: '视频源管理点击「增量采集」，或首页「追新电影」一键采集' },
  { label: '参数调整', text: '「采集配置」中可设置增量采集最大页数与断点小时数' },
  { label: '特点', text: '速度快、资源消耗小，建议定期执行保持数据最新' },
];

const AUTO_COLLECT_POINTS = [
  { label: '开启方式', text: '进入「设置 → 采集配置」，开启「自动增量采集」' },
  { label: '相关选项', text: '启用自动采集、定时采集间隔（小时）、启动时立即采集' },
  { label: '触发条件', text: '有启用视频源且无手动任务时才执行，回前台也会自动补检' },
  { label: '注意', text: '自动采集与手动采集互斥，手动采集进行中会自动跳过' },
];

export default function CollectGuideScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const surfaceElevatedBg = hexToRgba(colors.surfaceElevated, cardOpacity / 100);
  const s = useScaledFontSize();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15, backgroundColor: colors.surfaceElevated },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { paddingHorizontal: 15, gap: 12, paddingBottom: 30, paddingTop: 15 },
    card: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 16 },
    groupCard: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 16 },
    groupTitle: { fontSize: s(16), fontWeight: '600', color: colors.text, marginBottom: 4 },
    subTitle: { fontSize: s(15), fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 8 },
    text: { fontSize: s(14), color: colors.textSecondary, lineHeight: 22 },
    codeBox: { backgroundColor: surfaceElevatedBg, borderRadius: radius.sm, padding: 10, marginBottom: 8 },
    codeText: { fontFamily: 'monospace', fontSize: s(12), color: colors.mutedForeground },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    stepBadge: { width: 24, height: 24, borderRadius: radius.full, backgroundColor: colors.mutedForeground, justifyContent: 'center', alignItems: 'center' },
    stepBadgeText: { color: colors.text, fontSize: s(13), fontWeight: 'bold' },
    stepText: { fontSize: s(14), color: colors.textSecondary, flex: 1 },
    pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10 },
    pointLabel: { fontSize: s(14), fontWeight: '600', color: colors.text, width: 64, lineHeight: 22 },
    pointText: { fontSize: s(14), color: colors.textSecondary, flex: 1, lineHeight: 22 },
  }), [colors, cardBg, surfaceElevatedBg, s]);

  const renderSteps = (steps: string[]) => (
    steps.map((step, i) => (
      <View key={i} style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>{i + 1}</Text>
        </View>
        <Text style={styles.stepText}>{step}</Text>
      </View>
    ))
  );

  const renderPoints = (points: { label: string; text: string }[]) => (
    points.map((p, i) => (
      <View key={i} style={styles.pointRow}>
        <Text style={styles.pointLabel}>{p.label}</Text>
        <Text style={styles.pointText}>{p.text}</Text>
      </View>
    ))
  );

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>采集教程</Text>
          <View style={styles.placeholder} />
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.groupTitle}>采集教程</Text>
          <Text style={styles.text}>
            从配置视频源到全量、增量、自动采集，本教程带你完整掌握采集功能。
          </Text>
        </View>

        <View style={styles.groupCard}>
          <Text style={styles.groupTitle}>一、视频源配置</Text>
          <Text style={styles.text}>采集前必须先添加视频源，支持手动配置和 AI 导入两种方式。</Text>

          <Text style={styles.subTitle}>1. 手动配置</Text>
          {renderSteps(MANUAL_CONFIG_STEPS)}

          <Text style={styles.subTitle}>常见 CMS 接口格式参考</Text>
          {CMS_REFS.map((cms, i) => (
            <View key={i} style={[styles.card, i > 0 && { marginTop: 12 }]}>
              <Text style={styles.groupTitle}>{cms.name}</Text>
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{cms.apiFormat}</Text>
              </View>
              <Text style={styles.text}>{cms.tip}</Text>
            </View>
          ))}

          <Text style={styles.subTitle}>2. AI 导入</Text>
          {renderSteps(AI_IMPORT_STEPS)}
        </View>

        <View style={styles.groupCard}>
          <Text style={styles.groupTitle}>二、全量采集</Text>
          {renderPoints(FULL_COLLECT_POINTS)}
        </View>

        <View style={styles.groupCard}>
          <Text style={styles.groupTitle}>三、手动增量采集</Text>
          {renderPoints(INCREMENTAL_COLLECT_POINTS)}
        </View>

        <View style={styles.groupCard}>
          <Text style={styles.groupTitle}>四、自动增量采集</Text>
          {renderPoints(AUTO_COLLECT_POINTS)}
        </View>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
