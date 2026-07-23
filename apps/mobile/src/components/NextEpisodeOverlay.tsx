import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';

interface Props {
  show: boolean;
  nextEpisodeTitle: string;
  onNext: () => void;
  onClose: () => void;
}

export function NextEpisodeOverlay({ show, nextEpisodeTitle, onNext, onClose }: Props) {
  if (!show) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title} numberOfLines={1}>{nextEpisodeTitle}</Text>
      <TouchableOpacity style={styles.playButton} onPress={onNext}>
        <Text style={styles.playButtonText}>播放</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <X size={14} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 16,
    right: 8,
    zIndex: 30,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    maxWidth: 120,
  },
  playButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#4a9eff',
    borderRadius: 4,
  },
  playButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 2,
  },
});
