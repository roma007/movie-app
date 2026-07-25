import { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useThemeStore } from '../themes/store';
import { hexToRgba } from '../themes/colorUtils';

interface FilterOption {
  label: string;
  value: string | number;
}

interface FilterDropdownProps {
  label: string;
  options: FilterOption[];
  selected: string | number | undefined;
  onSelect: (value: string | number | undefined) => void;
  isExpanded: boolean;
  onToggle: () => void;
  grouped?: boolean;
}

export default function FilterDropdown({
  label,
  options,
  selected,
  onSelect,
  isExpanded,
  onToggle,
  grouped = false,
}: FilterDropdownProps) {
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const selectedLabel = useMemo(() => {
    if (selected === undefined || selected === null) return '全部';
    const found = options.find(o => o.value === selected);
    return found ? found.label : String(selected);
  }, [selected, options]);

  const hasActive = selected !== undefined && selected !== null;

  const decades = useMemo(() => {
    if (!grouped || options.length === 0) return [];
    const sorted = [...options].sort((a, b) => (b.value as number) - (a.value as number));
    const groups: { decade: string; items: FilterOption[] }[] = [];
    const seen = new Set<string>();
    for (const opt of sorted) {
      const year = opt.value as number;
      const decadeStart = Math.floor(year / 10) * 10;
      const decadeKey = `${decadeStart}s`;
      if (!seen.has(decadeKey)) {
        seen.add(decadeKey);
        groups.push({ decade: decadeKey, items: [] });
      }
      groups[groups.length - 1].items.push(opt);
    }
    return groups;
  }, [grouped, options]);

  useEffect(() => {
    if (grouped && expandedGroup === null && decades.length > 0) {
      setExpandedGroup(decades[0].decade);
    }
  }, [grouped, decades, expandedGroup]);

  const handleToggleGroup = useCallback((decade: string) => {
    setExpandedGroup(prev => prev === decade ? null : decade);
  }, []);

  const handleSelect = useCallback((value: string | number | undefined) => {
    onSelect(value);
  }, [onSelect]);

  const styles = useMemo(() => StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 6,
      backgroundColor: hasActive ? colors.primaryLight : cardBg,
    },
    triggerText: {
      fontSize: 13,
      color: hasActive ? colors.primary : colors.textSecondary,
      fontWeight: hasActive ? '500' : '400',
    },
    triggerArrow: {
      fontSize: 10,
      color: hasActive ? colors.primary : colors.mutedForeground,
      marginLeft: 4,
    },
    panel: {
      position: 'absolute',
      top: 40,
      left: 0,
      right: 0,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 101,
      elevation: 101,
      overflow: 'hidden',
    },
    panelContent: {
      padding: 10,
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    optionChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 6,
      backgroundColor: colors.surface,
    },
    optionChipActive: {
      backgroundColor: colors.primaryLight,
    },
    optionText: {
      fontSize: 13,
      color: colors.mutedForeground,
    },
    optionTextActive: {
      color: colors.primary,
      fontWeight: '500',
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    groupHeaderText: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.text,
    },
    groupArrow: {
      fontSize: 10,
      color: colors.mutedForeground,
    },
    groupItems: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 8,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 4,
    },
  }), [colors, hasActive, cardBg]);

  if (options.length === 0) return null;

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={onToggle}>
        <Text style={styles.triggerText} numberOfLines={1}>{label}: {selectedLabel}</Text>
        <Text style={styles.triggerArrow}>{isExpanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.panel}>
          <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.optionChip, !hasActive && styles.optionChipActive]}
              onPress={() => handleSelect(undefined)}
            >
              <Text style={[styles.optionText, !hasActive && styles.optionTextActive]}>全部</Text>
            </TouchableOpacity>

            {grouped ? (
              decades.map(group => (
                <View key={group.decade}>
                  <TouchableOpacity
                    style={styles.groupHeader}
                    onPress={() => handleToggleGroup(group.decade)}
                  >
                    <Text style={styles.groupHeaderText}>{group.decade}</Text>
                    <Text style={styles.groupArrow}>{expandedGroup === group.decade ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                  {expandedGroup === group.decade && (
                    <View style={styles.groupItems}>
                      {group.items.map(opt => {
                        const isActive = selected === opt.value;
                        return (
                          <TouchableOpacity
                            key={String(opt.value)}
                            style={[styles.optionChip, isActive && styles.optionChipActive]}
                            onPress={() => handleSelect(isActive ? undefined : opt.value)}
                          >
                            <Text style={[styles.optionText, isActive && styles.optionTextActive]}>{opt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.optionRow}>
                {options.map(opt => {
                  const isActive = selected === opt.value;
                  return (
                    <TouchableOpacity
                      key={String(opt.value)}
                      style={[styles.optionChip, isActive && styles.optionChipActive]}
                      onPress={() => handleSelect(isActive ? undefined : opt.value)}
                    >
                      <Text style={[styles.optionText, isActive && styles.optionTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </>
  );
}
