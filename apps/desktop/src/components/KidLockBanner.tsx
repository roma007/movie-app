import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Lock, LockOpen } from 'lucide-react';
import { useKidLockStore, getKidLockService } from '../stores/kidLockStore';
import { hashPinWithCrypto } from '../utils/kidLockCrypto';

/** 儿童模式全局横幅：激活时显示在内容区顶部，可输 PIN 解锁。 */
export function KidLockBanner() {
  const { active, loaded, refresh, setActive } = useKidLockStore();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
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
      const hash = await hashPinWithCrypto(pin, salt);
      if (!(await svc.verifyPin(hash))) {
        setError('密码错误，请重试');
        return;
      }
      await svc.disable();
      setActive(false);
      setOpen(false);
      setPin('');
      // 强制整页重建，让所有已加载列表立即回到全量内容
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || !active) return null;

  return (
    <>
      <div className="flex items-center justify-between px-6 py-2 text-sm shrink-0 bg-[var(--color-muted-alpha)]">
        <span className="flex items-center gap-2 font-medium">
          <Lock className="size-4" /> 儿童模式
        </span>
        <span className="text-muted-foreground text-xs">仅显示适合儿童观看的内容</span>
        <button
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          onClick={() => {
            setPin('');
            setError('');
            setOpen(true);
          }}
        >
          解锁 <LockOpen className="size-4" />
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-background">
          <DialogHeader>
            <DialogTitle>解锁儿童模式</DialogTitle>
            <DialogDescription>输入密码以查看全部内容</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="请输入密码"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUnlock();
            }}
          />
          {error && <div className="text-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleUnlock} disabled={busy}>
              解锁
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}