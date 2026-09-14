import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowLeft, KeyRound, Lock, LockOpen } from 'lucide-react';
import { useKidLockStore, getKidLockService } from '../stores/kidLockStore';
import { hashPinWithCrypto, randomSalt } from '../utils/kidLockCrypto';

type Action = 'setup' | 'enable' | 'disable' | 'change' | null;

function validatePin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return '请输入 4~6 位数字密码';
  return null;
}

export default function KidLockPage() {
  const navigate = useNavigate();
  const { active, loaded, refresh, setActive } = useKidLockStore();

  const [hasPin, setHasPin] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [pinA, setPinA] = useState('');
  const [pinB, setPinB] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    refresh();
    getKidLockService()
      .hasPin()
      .then(setHasPin)
      .catch(() => {});
  }, [refresh]);

  const svc = getKidLockService();

  const computeHash = async (pin: string, salt: string) => hashPinWithCrypto(pin, salt);

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
      const salt = randomSalt();
      const hash = await computeHash(pinA, salt);
      await svc.setPin(hash, salt);
      await svc.enable();
      await runBackfillIfNeeded();
      setHasPin(true);
      setActive(true);
      setAction(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyAnd = async (ok: () => Promise<void>) => {
    const err = validatePin(pinA);
    setError(err || '');
    if (err) return;
    setBusy(true);
    try {
      const salt = await svc.getSalt();
      const hash = await computeHash(pinA, salt);
      if (!(await svc.verifyPin(hash))) {
        setError('密码错误，请重试');
        return;
      }
      await ok();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = () =>
    verifyAnd(async () => {
      await svc.enable();
      await runBackfillIfNeeded();
      setActive(true);
      setAction(null);
    });

  const handleDisable = () =>
    verifyAnd(async () => {
      await svc.disable();
      setActive(false);
      setAction(null);
    });

  const renderActionForm = () => {
    if (action === 'setup') {
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">设置密码（4~6 位数字）</label>
            <Input type="password" inputMode="numeric" maxLength={6} value={pinA} onChange={(e) => setPinA(e.target.value)} placeholder="请输入 4~6 位数字" />
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">确认密码</label>
            <Input type="password" inputMode="numeric" maxLength={6} value={pinB} onChange={(e) => setPinB(e.target.value)} placeholder="再次输入密码" />
          </div>
          <Button onClick={handleSaveAndEnable} disabled={busy || backfilling}>
            <Lock className="size-4" /> 保存并开启儿童模式
          </Button>
        </div>
      );
    }
    if (action === 'enable') {
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">输入密码开启儿童模式</label>
            <Input type="password" inputMode="numeric" maxLength={6} value={pinA} onChange={(e) => setPinA(e.target.value)} placeholder="请输入密码" />
          </div>
          <Button onClick={handleEnable} disabled={busy || backfilling}>
            <Lock className="size-4" /> 开启儿童模式
          </Button>
        </div>
      );
    }
    if (action === 'disable') {
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">输入密码关闭儿童模式</label>
            <Input type="password" inputMode="numeric" maxLength={6} value={pinA} onChange={(e) => setPinA(e.target.value)} placeholder="请输入密码" />
          </div>
          <Button onClick={handleDisable} disabled={busy || backfilling}>
            <LockOpen className="size-4" /> 关闭儿童模式
          </Button>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <button
        className="text-sm text-muted-foreground hover:text-text transition-colors flex items-center gap-1"
        onClick={() => navigate('/settings')}
      >
        <ArrowLeft className="size-4" /> 返回设置
      </button>

      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="size-5" />
          <h2 className="text-lg font-semibold">儿童锁</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          开启后仅显示适合儿童观看的内容，关闭儿童模式需要输入密码。
        </p>

        <div className="mt-4 rounded-lg bg-[var(--color-muted-alpha)] px-4 py-3 text-sm">
          {!loaded ? (
            <span>加载中…</span>
          ) : active ? (
            <span className="flex items-center gap-2 text-[var(--color-button-primary-text)]">
              <Lock className="size-4" /> 儿童模式已开启：全站仅显示适合儿童的内容
            </span>
          ) : hasPin ? (
            <span className="flex items-center gap-2">
              <LockOpen className="size-4" /> 儿童模式未开启
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Lock className="size-4" /> 尚未设置儿童锁密码
            </span>
          )}
        </div>

        {backfilling && (
          <div className="mt-4 space-y-2">
            <div className="text-sm text-muted-foreground">正在为现有内容打适龄标记，请稍候…</div>
            {progress && progress.total > 0 && (
              <div className="h-2 w-full rounded-full bg-[var(--color-secondary-alpha)]">
                <div
                  className="h-2 rounded-full bg-[var(--color-muted-alpha)] transition-all"
                  style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
            {progress && (
              <div className="text-xs text-muted-foreground">
                {progress.done} / {progress.total}
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}

        <div className="mt-5 space-y-2">
          {!hasPin && (
            <Button onClick={() => { setError(''); setPinA(''); setPinB(''); setAction('setup'); }}>
              设置儿童锁密码
            </Button>
          )}
          {hasPin && !active && (
            <Button onClick={() => { setError(''); setPinA(''); setAction('enable'); }}>
              <Lock className="size-4" /> 开启儿童模式
            </Button>
          )}
          {active && (
            <Button onClick={() => { setError(''); setPinA(''); setAction('disable'); }}>
              <LockOpen className="size-4" /> 关闭儿童模式
            </Button>
          )}
        </div>

        {action && <div className="mt-5 border-t pt-5">{renderActionForm()}</div>}
      </Card>
    </div>
  );
}