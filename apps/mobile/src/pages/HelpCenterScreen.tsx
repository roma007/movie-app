import { View, Text, StyleSheet, ScrollView } from 'react-native';

interface Props {
  navigation: any;
}

const FAQS = [
  {
    q: '视频从哪来？',
    a: '视频内容来源于您添加的视频源（CMS 资源站）。添加视频源并采集后，即可浏览和播放视频。',
  },
  {
    q: '怎么看视频？',
    a: '在首页浏览或搜索视频，点击进入详情页，选择剧集后即可播放。如果您还没有视频数据，请先在设置中添加视频源并采集。',
  },
  {
    q: '如何添加视频源？',
    a: '进入「设置」→「视频源管理」，点击「添加视频源」，填写编码、名称和 API 地址即可。常见的 CMS 源包括海洋CMS、苹果CMS等。',
  },
  {
    q: '如何收藏视频？',
    a: '在视频详情页点击收藏按钮（❤️），即可将视频添加到收藏列表。收藏的视频会在首页快捷显示。',
  },
  {
    q: '播放不了怎么办？',
    a: '尝试切换播放线路（如果有多个源）。如果所有线路都失败，可能是视频源失效，建议重新采集或更换视频源。',
  },
];

export default function HelpCenterScreen(_: Props) {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>帮助中心</Text>
      </View>
      <View style={styles.content}>
        {FAQS.map((faq, index) => (
          <View key={index} style={styles.card}>
            <Text style={styles.question}>{faq.q}</Text>
            <Text style={styles.answer}>{faq.a}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footer}>更多问题请联系管理员</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  content: { paddingHorizontal: 15, gap: 12 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16 },
  question: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 8 },
  answer: { fontSize: 14, color: '#bbb', lineHeight: 22 },
  footer: { textAlign: 'center', color: '#666', fontSize: 13, paddingVertical: 30 },
});
