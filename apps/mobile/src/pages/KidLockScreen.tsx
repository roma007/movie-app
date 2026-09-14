import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { ArrowLeft, Lock, LockOpen, KeyRound } from 'lucide-react-native';
import { getProvider } from '../useAppStore';
import { useThemeColors } from '../themes/useThemeColors';
import { useScaledFontSize } from '../themes/useScaledFontSize';
import { hexToRgba } from '../themes/colorUtils';
import { useThemeStore } from '../themes/store';
import { radius } from '../themes/radiusTokens';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import BlurredBackground from '../components/BlurredBackground';
import { useKidLockStore, getKidLockService } from '../stores/kidLockStore';
import { hashPin, randomSalt } from '../utils/kidLockCrypto';

interface Props {
  navigation: any;
}

type Action = 'setup' | 'enable' | 'disable' | null;

function validatePin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return '请输入 4~6 位数字密码';
  return null;
}

export default function KidLockScreen({ navigation }: Props) {
  const { active, loaded, refresh, setActive } = useKidLockStore();
  const colors = useThemeColors();
  const cardOpacity = useThemeStore((s) => s.cardOpacity);
  const cardBg = hexToRgba(colors.card, cardOpacity / 100);
  const s = useScaledFontSize();

  const [hasPin, setHasPin] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [pinA, setPinA] = useState('');
  const [pinB, setPinB] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void refresh();
    void getKidLockService()
      .hasPin()
      .then(setHasPin)
      .catch(() => {});
  }, [refresh]);

  const svc = getKidLockService();

  const runBackfillIfNeeded = async () => {
    if (await svc.isBackfilled()) return;
    setBackfilling(true);
    setProgress(null);
    try {
      await svc.backfillKidSafe((done, total) => setProgress({ done, total }));
    } finally {
      setBackfilling(false);
    }
  };

  const handleSaveAndEnable = async () => {
    const err = validatePin(pinA);
    setError(err || '');
    if (err) return;
    if (pinA !== pinB) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const salt = await randomSalt();
      const hash = await hashPin(pinA, salt);
      await svc.setPin(hash, salt);
      await svc.enable();
      await runBackfillIfNeeded();
      setHasPin(true);
      setActive(true);
      setAction(null);
      setPinA('');
      setPinB('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyAnd = async (ok: () => Promise<void>, successMsg: string) => {
    const err = validatePin(pinA);
    setError(err || '');
    if (err) return;
    setBusy(true);
    try {
      const salt = await svc.getSalt();
      const hash = await hashPin(pinA, salt);
      if (!(await svc.verifyPin(hash))) {
        setError('密码错误，请重试');
        return;
      }
      await ok();
      setPinA('');
      setAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      setBusy(false);
    }
    Alert.alert('提示', successMsg);
  };

  const handleEnable = () =>
    verifyAnd(async () => {
      await svc.enable();
      await runBackfillIfNeeded();
      setActive(true);
    }, '儿童模式已开启');

  const handleDisable = () =>
    verifyAnd(async () => {
      await svc.disable();
      setActive(false);
    }, '儿童模式已关闭');

  const openAction = (a: Action) => {
    setError('');
    setPinA('');
    setPinB('');
    setAction(a);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1 },
        header: { paddingTop: 50, paddingHorizontal: 15, paddingBottom: 15 },
        headerRow: { flexDirection: 'row', alignItems: 'center' },
        title: { flex: 1, fontSize: s(18), fontWeight: 'bold', color: colors.text, textAlign: 'center' },
        placeholder: { width: 40 },
        content: { padding: 15 },
        card: {
          backgroundColor: cardBg,
          borderRadius: radius.lg,
          overflow: 'hidden',
          marginBottom: 20,
        },
        cardBody: { padding: 15 },
        iconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
        cardTitle: { fontSize: s(16), fontWeight: 'bold', color: colors.text },
        desc: { fontSize: s(13), color: colors.mutedForeground, lineHeight: 20 },
        statusBox: {
          marginTop: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: radius.md,
          backgroundColor: hexToRgba(colors.mutedForeground, cardOpacity / 100 * 0.2),
        },
        statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        statusText: { fontSize: s(13), color: colors.text },
        statusTextActive: { fontSize: s(13), color: colors.buttonPrimaryText },
        progressBox: { marginTop: 12 },
        progressText: { fontSize: s(12), color: colors.mutedForeground, marginBottom: 6 },
        errorText: { marginTop: 10, fontSize: s(13), color: '#ef4444' },
        buttonWrap: { marginTop: 14 },
        form: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
        fieldLabel: { fontSize: s(12), color: colors.mutedForeground, marginBottom: 6, marginTop: 8 },
      }),
[colors, cardBg, cardOpacity, s],
    );

  const renderActionForm = () => {
    if (action === 'setup') {
      return (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>设置密码（4~6 位数字）</Text>
          <Input
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={pinA}
            onChangeText={setPinA}
            placeholder="请输入 4~6 位数字"
          />
          <Text style={styles.fieldLabel}>确认密码</Text>
          <Input
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={pinB}
            onChangeText={setPinB}
            placeholder="再次输入密码"
          />
          <View style={styles.buttonWrap}>
            <Button onPress={handleSaveAndEnable} disabled={busy || backfilling}>
              保存并开启儿童模式
            </Button>
          </View>
        </View>
      );
    }
    if (action === 'enable' || action === 'disable') {
      return (
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>
            {action === 'enable' ? '输入密码开启儿童模式' : '输入密码关闭儿童模式'}
          </Text>
          <Input
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={pinA}
            onChangeText={setPinA}
            placeholder="请输入密码"
          />
          <View style={styles.buttonWrap}>
            <Button onPress={action === 'enable' ? handleEnable : handleDisable} disabled={busy || backfilling}>
              {action === 'enable' ? '开启儿童模式' : '关闭儿童模式'}
            </Button>
          </View>
        </View>
      );
    }
    return null;
  };

  return (
    <BlurredBackground imageUrl={null}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Button variant="icon" onPress={() => navigation.goBack()}>
              <ArrowLeft size={20} color={colors.text} />
            </Button>
            <Text style={styles.title}>儿童锁</Text>
            <View style={styles.placeholder} />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardBody}>
              <View style={styles.iconRow}>
                <KeyRound size={18} color={colors.mutedForeground} />
                <Text style={styles.cardTitle}>儿童锁</Text>
              </View>
              <Text style={styles.desc}>
                开启后仅显示适合儿童观看的内容，关闭儿童模式需要输入密码。
              </Text>
              <View style={styles.statusBox}>
                {!loaded ? (
                  <Text style={styles.statusText}>加载中…</Text>
                ) : active ? (
                  <View style={styles.statusRow}>
                    <Lock size={14} color={colors.buttonPrimaryText} />
                    <Text style={styles.statusTextActive}>儿童模式已开启：全站仅显示适合儿童的内容</Text>
                  </View>
                ) : hasPin ? (
                  <View style={styles.statusRow}>
                    <LockOpen size={14} color={colors.text} />
                    <Text style={styles.statusText}>儿童模式未开启</Text>
                  </View>
                ) : (
                  <View style={styles.statusRow}>
                    <Lock size={14} color={colors.text} />
                    <Text style={styles.statusText}>尚未设置儿童锁密码</Text>
                  </View>
                )}
              </View>

              {backfilling && (
                <View style={styles.progressBox}>
                  <Text style={styles.progressText}>正在为现有内容打适龄标记，请稍候…</Text>
                  {progress && (
                    <Text style={styles.progressText}>
                      进度：{progress.done} / {progress.total}
                    </Text>
                  )}
                </View>
              )}

              {!!error && <Text style={styles.errorText}>{error}</Text>}

              <View style={styles.buttonWrap}>
                {!hasPin && (
                  <Button onPress={() => openAction('setup')}>
                    设置儿童锁密码
                  </Button>
                )}
                {hasPin && !active && (
                  <Button leftIcon={<Lock size={16} color={colors.buttonPrimaryText} />} onPress={() => openAction('enable')}>
                    开启儿童模式
                  </Button>
                )}
                {active && (
                  <Button leftIcon={<LockOpen size={16} color={colors.buttonPrimaryText} />} onPress={() => openAction('disable')}>
                    关闭儿童模式
                  </Button>
                )}
              </View>

              {action && renderActionForm()}
            </View>
          </View>
        </ScrollView>
      </View>
    </BlurredBackground>
  );
}