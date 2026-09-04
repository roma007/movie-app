import { useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { X, Cast, Wifi, Monitor } from 'lucide-react-native';
import { useThemeColors } from '../../themes/useThemeColors';
import { useCastStore } from '../../stores/castStore';
import { useCastManager } from '../../hooks/useCastManager';
import { radius } from '../../themes/radiusTokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (device: { id: string; name: string; protocol: string }) => void;
}

export function DevicePickerSheet({ visible, onClose, onSelect }: Props) {
  const colors = useThemeColors();
  const { availableDevices, isSearching } = useCastStore();

  const dlnaDevices = availableDevices.filter((d) => d.protocol === 'dlna');
  const airplayDevices = availableDevices.filter((d) => d.protocol === 'airplay');

  const hasAnyDevices = dlnaDevices.length > 0 || airplayDevices.length > 0;

  const handleDevicePress = (device: { id: string; name: string; protocol: string }) => {
    onSelect(device);
  };

  const protocolSections = [
    { title: 'AirPlay', devices: airplayDevices, icon: <Monitor size={14} color={colors.mutedForeground} /> },
    { title: 'DLNA', devices: dlnaDevices, icon: <Wifi size={14} color={colors.mutedForeground} /> },
  ].filter((s) => s.devices.length > 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { backgroundColor: colors.card }]}>
              <View style={styles.header}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  选择投屏设备
                </Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                  <X size={20} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {isSearching ? (
                <View style={styles.emptyWrap}>
                  <ActivityIndicator size="large" color={colors.success} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    正在搜索投屏设备...
                  </Text>
                </View>
              ) : !hasAnyDevices ? (
                <View style={styles.emptyWrap}>
                  <Cast size={32} color={colors.mutedForeground} />
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    未发现投屏设备
                  </Text>
                  <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                    请确保手机与电视在同一局域网
                  </Text>
                </View>
              ) : (
                <View style={styles.deviceList}>
                  {protocolSections.map((section) => (
                    <View key={section.title} style={styles.section}>
                      <View style={styles.sectionHeader}>
                        {section.icon}
                        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                          {section.title}
                        </Text>
                      </View>
                      {section.devices.map((device) => (
                        <TouchableOpacity
                          key={device.id}
                          activeOpacity={0.7}
                          onPress={() => handleDevicePress(device)}
                          style={[styles.deviceItem, { backgroundColor: colors.background }]}
                        >
                          <View style={[styles.deviceDot, { backgroundColor: device.isConnected ? '#4ade80' : colors.mutedForeground }]} />
                          <Text style={[styles.deviceName, { color: colors.foreground }]}>
                            {device.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}

                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={onClose}
                    style={[styles.mirrorSection, { borderTopColor: colors.border }]}
                  >
                    <View style={styles.sectionHeader}>
                      <Monitor size={14} color={colors.mutedForeground} />
                      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                        屏幕镜像（系统功能）
                      </Text>
                    </View>
                    <Text style={[styles.mirrorHint, { color: colors.mutedForeground }]}>
                      从系统控制中心开启 →
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
  },
  emptyHint: {
    fontSize: 13,
  },
  deviceList: {
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  deviceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceName: {
    fontSize: 15,
  },
  mirrorSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    marginTop: 4,
  },
  mirrorHint: {
    fontSize: 13,
    marginLeft: 20,
    marginTop: 4,
  },
});
