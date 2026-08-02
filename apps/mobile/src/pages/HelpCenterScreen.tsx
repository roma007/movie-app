import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react-native';
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

const FAQ_GROUPS = [
  {
    title: '新手入门',
    items: [
      {
        q: '视频从哪来？',
        a: '视频内容来源于您添加的视频源（CMS 资源站）。添加视频源并采集后，即可浏览和播放视频。采集教程中有详细的配置方法。',
      },
      {
        q: '怎么看视频？',
        a: '在首页浏览或搜索视频，点击进入详情页，选择剧集后即可播放。如果您还没有视频数据，请先添加视频源并采集。',
      },
      {
        q: '如何添加视频源？',
        a: '进入「设置」→「视频源管理」，可「手动添加」填写编码、名称和 API 地址，也可用「AI 导入」批量添加。详见采集教程。',
      },
    ],
  },
  {
    title: '采集相关',
    items: [
      {
        q: '全量、增量、自动采集有什么区别？',
        a: '全量采集拉取源站全部数据，耗时较长，适合首次使用；增量采集只采集新增内容，适合日常追新；自动采集按设定间隔定时执行增量采集，无需手动操作。详见采集教程。',
      },
      {
        q: '采集到的数据不全或重复怎么办？',
        a: '本应用使用指纹去重机制，相同名称和年份的视频会自动去重。数据不全可能是视频源 API 限制了返回数量，可在「采集配置」调整页数参数。',
      },
      {
        q: '采集时提示"无法连接视频源"怎么办？',
        a: '请检查 API 地址是否正确、网络能否访问，并用「检测」功能验证。部分站点需要特殊网络环境才能访问。',
      },
      {
        q: '自动采集为什么没执行？',
        a: '请检查是否已在「采集配置」开启自动采集、是否有启用中的视频源，以及是否与手动采集冲突。自动采集仅在无手动任务且达到间隔时触发。',
      },
    ],
  },
  {
    title: '播放相关',
    items: [
      {
        q: '播放不了怎么办？',
        a: '尝试切换其他播放线路，或稍后再试。如果所有线路都不可用，可能是视频源失效，建议重新采集或更换视频源。',
      },
      {
        q: '片尾下一集提示是什么？',
        a: '播放接近片尾时会提前提示下一集，可在「使用偏好」中开启/关闭并调整提前分钟数。',
      },
      {
        q: '播放缓冲卡顿怎么调？',
        a: '在「使用偏好」中可调整「播放缓冲并发数」和「播放缓冲内存上限」。并发数越大卡顿越少，但越容易引起片源方反爬，请酌情调整。',
      },
    ],
  },
  {
    title: '常用功能',
    items: [
      {
        q: '如何收藏视频？',
        a: '在视频详情页点击收藏按钮（❤️），即可加入收藏列表。收藏的视频会在首页快捷显示。',
      },
      {
        q: '观看历史在哪里？如何清除？',
        a: '首页会展示观看记录并支持断点续播。可在设置侧边栏点击「清除观看历史」一键清空。',
      },
      {
        q: '首页显示哪些内容怎么调整？',
        a: '在「使用偏好」的首页偏好中可多选「搜索优先」「追新电影」「追剧/综艺」，首页会根据偏好展示对应卡片。',
      },
      {
        q: '黑名单关键词有什么用？',
        a: '在「采集配置」中添加黑名单关键词后，采集时会自动过滤类型名称包含这些关键词的视频。',
      },
      {
        q: '如何隐藏不想看的视频分类？',
        a: '在「视频管理」的隐藏管理中可隐藏子类型，隐藏后相关分类不再显示。移动端隐藏管理操作在桌面端完整可用。',
      },
    ],
  },
];

export default function HelpCenterScreen({ navigation }: Props) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15, backgroundColor: colors.surfaceElevated },
    headerRow: { flexDirection: 'row', alignItems: 'center' },
    title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
    placeholder: { width: 40 },
    content: { paddingHorizontal: 15, gap: 12, paddingTop: 15, paddingBottom: 30 },
    card: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 16 },
    guideEntry: { backgroundColor: cardBg, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center' },
    guideIcon: { width: 36, height: 36, borderRadius: radius.lg, backgroundColor: colors.buttonPrimaryBg, alignItems: 'center', justifyContent: 'center' },
    guideInfo: { flex: 1, marginLeft: 12 },
    guideTitle: { fontSize: s(16), fontWeight: '600', color: colors.text },
    guideDesc: { fontSize: s(13), color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
    groupTitle: { fontSize: s(15), fontWeight: '600', color: colors.text, marginBottom: 8 },
    faqRow: { paddingVertical: 12 },
    faqRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    faqQuestion: { fontSize: s(14), color: colors.text, fontWeight: '500', flex: 1, marginRight: 8 },
    faqAnswer: { fontSize: s(13), color: colors.textSecondary, lineHeight: 20, marginTop: 8 },
    footer: { textAlign: 'center', color: colors.disabledForeground, fontSize: s(13), paddingVertical: 10 },
  }), [colors, cardBg, s]);

  return (
    <BlurredBackground imageUrl={null}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Button variant="icon" size="sm" onPress={() => navigation.goBack()}>
            <ArrowLeft size={20} color={colors.text} />
          </Button>
          <Text style={styles.title}>帮助中心</Text>
          <View style={styles.placeholder} />
        </View>
      </View>
      <View style={styles.content}>
        <TouchableOpacity
          style={styles.guideEntry}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('CollectGuide')}
        >
          <View style={styles.guideIcon}>
            <BookOpen size={18} color="#fff" />
          </View>
          <View style={styles.guideInfo}>
            <Text style={styles.guideTitle}>采集教程</Text>
            <Text style={styles.guideDesc}>视频源配置 · 全量采集 · 增量采集 · 自动采集</Text>
          </View>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </TouchableOpacity>

        {FAQ_GROUPS.map((group, gi) => (
          <View key={gi} style={styles.card}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.items.map((faq, fi) => {
              const key = `${gi}-${fi}`;
              const open = !!expanded[key];
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.faqRow, fi > 0 && styles.faqRowBorder]}
                  activeOpacity={0.7}
                  onPress={() => toggle(key)}
                >
                  <View style={styles.faqHeader}>
                    <Text style={styles.faqQuestion}>{faq.q}</Text>
                    <ChevronRight
                      size={16}
                      color={colors.mutedForeground}
                      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
                    />
                  </View>
                  {open && <Text style={styles.faqAnswer}>{faq.a}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <Text style={styles.footer}>更多问题请联系管理员</Text>
      </View>
    </ScrollView>
    </BlurredBackground>
  );
}
