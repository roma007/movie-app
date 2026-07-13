import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'movie_app_announcement_seen';
const ANNOUNCEMENT_VERSION = '1';

export function AnnouncementDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== ANNOUNCEMENT_VERSION) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, ANNOUNCEMENT_VERSION);
    setOpen(false);
  };

  const handleViewTutorial = () => {
    localStorage.setItem(STORAGE_KEY, ANNOUNCEMENT_VERSION);
    setOpen(false);
    window.open('https://www.mdzyapi.com/caiji/', '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="w-full max-w-[45vw]">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold">重要通知</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm text-foreground py-4">
          <p>欢迎使用 Movie App！</p>
          <p>本应用数据来源：魔都资源网（moduzy.vip）</p>
          <p>备用域名：moduzy1.com 至 moduzy15.com</p>
          <p>M3U8解析接口：https://www.modujiexi66.com/?url=</p>
          <p>官方交流群：@mdzyw</p>
        </div>
        <DialogFooter className="flex gap-2 justify-center">
          <Button onClick={handleClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}