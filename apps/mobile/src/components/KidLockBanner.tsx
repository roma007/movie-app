import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Lock, LockOpen } from 'lucide-react-native';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { radius } from '../themes/radiusTokens';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { useKidLockStore, getKidLockService } from '../stores/kidLockStore';
import { hashPin } from '../utils/kidLockCrypto';

interface Props {
  /** 解锁成功后回调（用于刷新已加载列表） */
  onUnlocked?: () => void;
}

/** 儿童模式全局横幅：激活时显示在首页头部，可输 PIN 解锁。 */
export function KidLockBanner({ onUnlocked }: Props) {
  const { active, loaded, refresh, setActive } = useKidLockStore();
  const colors = useThemeColors();
  const s = useScaledFontSize();

  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUnlock = async () => {
    setError('');
    if (!/^\d{4,6}$/.test(pin)) {
      setError('请输入 4~6 位数字密码');
      return;
    }
    setBusy(true);
    try {
      const svc = getKidLockService();
      const salt = await svc.getSalt();
      const hash = await hashPin(pin, salt);
      if (!(await svc.verifyPin(hash))) {
        setError('密码错误，请重试');
        return;
      }
      await svc.disable();
      setActive(false);
      setOpen(false);
      setPin('');
      onUnlocked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        banner: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingVertical: 8,
          marginHorizontal: 10,
          marginTop: 4,
          borderRadius: radius.md,
          backgroundColor: colors.mutedForeground,
        },
        bannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        bannerText: { fontSize: s(12), fontWeight: '600', color: '#ffffff' },
        bannerSub: { fontSize: s(10), color: 'rgba(255,255,255,0.85)' },
        bannerUnlock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        bannerUnlockText: { fontSize: s(12), color: '#ffffff', fontWeight: '600' },
        overlay: {
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        card: {
          width: '80%',
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: 16,
        },
        title: { fontSize: s(16), fontWeight: 'bold', color: colors.text, marginBottom: 6 },
        desc: { fontSize: s(13), color: colors.mutedForeground, marginBottom: 12 },
        errorText: { marginTop: 8, fontSize: s(13), color: '#ef4444' },
        btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
      }),
    [colors, s],
  );

  if (!loaded || !active) return null;

  return (
    <>
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <Lock size={14} color="#ffffff" />
          <View>
            <Text style={styles.bannerText}>儿童模式</Text>
            <Text style={styles.bannerSub}>仅显示适合儿童观看的内容</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.bannerUnlock}
          onPress={() => {
            setPin('');
            setError('');
            setOpen(true);
          }}
        >
          <LockOpen size={13} color="#ffffff" />
          <Text style={styles.bannerUnlockText}>解锁</Text>
        </TouchableOpacity>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.card} onStartShouldSetResponder={() => true}>
            <Text style={styles.title}>解锁儿童模式</Text>
            <Text style={styles.desc}>输入密码以查看全部内容</Text>
            <Input
              secureTextEntry
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              value={pin}
              onChangeText={setPin}
              placeholder="请输入密码"
            />
            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.btnRow}>
              <Button variant="secondary" onPress={() => setOpen(false)}>
                取消
              </Button>
              <Button onPress={handleUnlock} disabled={busy}>
                解锁
              </Button>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}