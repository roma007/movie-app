import { View, Text, Modal, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { X, Monitor } from 'lucide-react-native';
import { useThemeColors } from '../../themes/useThemeColors';
import { radius } from '../../themes/radiusTokens';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ScreenMirrorGuide({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const isIOS = Platform.OS === 'ios';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.header}>
            <Monitor size={24} color={colors.foreground} />
            <Text style={[styles.title, { color: colors.foreground }]}>屏幕镜像</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.desc, { color: colors.mutedForeground }]}>
            屏幕镜像是系统功能，需要从控制中心开启：
          </Text>

          {isIOS ? (
            <View style={styles.steps}>
              <Step num={1} text="从屏幕右上角向下滑动，打开控制中心" colors={colors} />
              <Step num={2} text="点击「屏幕镜像」按钮" colors={colors} />
              <Step num={3} text="选择你的电视设备" colors={colors} />
            </View>
          ) : (
            <View style={styles.steps}>
              <Step num={1} text="从屏幕顶部向下滑动，打开通知栏" colors={colors} />
              <Step num={2} text="点击「无线投屏」或「屏幕镜像」" colors={colors} />
              <Step num={3} text="选择你的电视设备" colors={colors} />
            </View>
          )}

          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            注意：镜像会复制手机全部画面，包含通知等隐私内容
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function Step({ num, text, colors }: { num: number; text: string; colors: any }) {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.stepNum, { backgroundColor: colors.foreground }]}>
        <Text style={[styles.stepNumText, { color: colors.background }]}>{num}</Text>
      </View>
      <Text style={[styles.stepText, { color: colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    borderRadius: radius.xl,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  steps: {
    gap: 12,
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stepText: {
    fontSize: 14,
    flex: 1,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
