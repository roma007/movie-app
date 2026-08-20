import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Cast } from 'lucide-react-native';
import { useThemeColors } from '../../themes/useThemeColors';
import { useCastStore } from '../../stores/castStore';
import { radius } from '../../themes/radiusTokens';
import { DevicePickerSheet } from './DevicePickerSheet';

interface Props {
  onDeviceSelect: (device: { id: string; name: string; protocol: string }) => void;
  onSearch?: () => void;
  style?: any;
}

export function CastButton({ onDeviceSelect, onSearch, style }: Props) {
  const colors = useThemeColors();
  const { isCasting, castDevice } = useCastStore();
  const [pickerVisible, setPickerVisible] = useState(false);

  const handlePress = () => {
    onSearch?.();
    setPickerVisible(true);
  };

  const handleDeviceSelect = (device: { id: string; name: string; protocol: string }) => {
    setPickerVisible(false);
    onDeviceSelect(device);
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        style={[styles.container, style]}
      >
        <View style={styles.iconWrap}>
          <Cast size={18} color={isCasting ? '#4ade80' : '#fff'} />
          {isCasting && (
            <View style={[styles.dot, { backgroundColor: '#4ade80' }]} />
          )}
        </View>
        {isCasting && castDevice && (
          <Text style={[styles.deviceName, { color: '#4ade80' }]} numberOfLines={1}>
            {castDevice.name}
          </Text>
        )}
      </TouchableOpacity>
      <DevicePickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleDeviceSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconWrap: {
    position: 'relative',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  deviceName: {
    fontSize: 11,
    maxWidth: 60,
  },
});
