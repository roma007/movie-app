import { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { useAppStore } from '../useAppStore';
import type { UserUsageType } from '@movie-app/core';

const OPTIONS: { type: UserUsageType; label: string; desc: string; icon: string }[] = [
  { type: 'SEARCH_FIRST', label: '搜索优先', desc: '临时搜索采集，找想看的视频', icon: '🔍' },
  { type: 'NEW_MOVIES', label: '新片追逐', desc: '增量采集最新电影，挑选感兴趣的', icon: '🎬' },
  { type: 'TV_SERIES', label: '追剧/综艺', desc: '追更电视剧/综艺，追完再增量采集', icon: '📺' },
];

export default function UsageGuideModal() {
  const [visible, setVisible] = useState(true);
  const { setUserUsageTypes } = useAppStore();
  const [selected, setSelected] = useState<Set<UserUsageType>>(new Set());

  const handleToggle = (type: UserUsageType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    await setUserUsageTypes([...selected]);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>选择你的使用方式</Text>
          <Text style={styles.subtitle}>
            可多选，首页将展示所有选中类型的核心功能卡片（后续可在设置中修改）
          </Text>

          {OPTIONS.map((opt) => {
            const isActive = selected.has(opt.type);
            return (
              <TouchableOpacity
                key={opt.type}
                style={[styles.option, isActive && styles.optionActive]}
                onPress={() => handleToggle(opt.type)}
              >
                <View style={[styles.checkbox, isActive && styles.checkboxActive]}>
                  {isActive && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.optionIcon}>{opt.icon}</Text>
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.optionDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => setVisible(false)}>
              <Text style={styles.skipBtnText}>跳过</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, selected.size === 0 && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={selected.size === 0}
            >
              <Text style={[styles.confirmBtnText, selected.size === 0 && styles.confirmBtnTextDisabled]}>
                确认（{selected.size} 项）
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  container: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 10,
    backgroundColor: '#0f0f0f',
  },
  optionActive: {
    borderColor: '#4a9eff',
    backgroundColor: 'rgba(74, 158, 255, 0.08)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#666',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    borderColor: '#4a9eff',
    backgroundColor: '#4a9eff',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  optionIcon: {
    fontSize: 24,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  optionLabelActive: {
    color: '#4a9eff',
  },
  optionDesc: {
    fontSize: 12,
    color: '#888',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  skipBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  skipBtnText: {
    color: '#888',
    fontSize: 14,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#4a9eff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: '#333',
  },
  confirmBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmBtnTextDisabled: {
    color: '#666',
  },
});
