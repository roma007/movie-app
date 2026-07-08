import { useEffect, useState } from 'react';
import { useAppStore } from '../useAppStore';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import type { VideoSource } from '@movie-app/core';

export default function SourceManagerPage() {
  const { videoSources, loadVideoSources, toggleSourceEnabled, removeVideoSource, addVideoSource, reorderSource } = useAppStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });

  useEffect(() => {
    loadVideoSources();
  }, []);

  const handleMove = async (index: number, dir: 'up' | 'down') => {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= videoSources.length) return;
    const a = videoSources[index];
    const b = videoSources[target];
    await reorderSource(a.id, b.priority);
    await reorderSource(b.id, a.priority);
  };

  const handleAdd = async () => {
    const code = form.code.trim();
    if (!code || !form.name.trim() || !form.baseUrl.trim()) return;
    const source: VideoSource = {
      id: `source_${code}`,
      code,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      type: 'CMS',
      isEnabled: true,
      rateLimit: Number(form.rateLimit) || 5,
      priority: Number(form.priority) || 0,
      healthStatus: null,
      lastCheckAt: null,
    };
    await addVideoSource(source);
    setForm({ code: '', name: '', baseUrl: '', rateLimit: '5', priority: '0' });
    setOpen(false);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`确定要删除「${name}」吗？`)) {
      removeVideoSource(id);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">视频源管理</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> 添加视频源
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加视频源</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>编码（唯一标识）</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如 hcwv" />
              </div>
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 红尘视频" />
              </div>
              <div className="space-y-1.5">
                <Label>API 地址</Label>
                <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://example.com/api.php/provide/vod" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>速率限制（1-10）</Label>
                  <Input type="number" value={form.rateLimit} onChange={(e) => setForm({ ...form, rateLimit: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>优先级</Label>
                  <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleAdd}>添加</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {videoSources.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          暂无视频源，请点击「添加视频源」
        </div>
      ) : (
        <div className="space-y-3">
          {videoSources.map((source, index) => (
            <Card key={source.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{source.name}</span>
                    <Badge variant="outline" className="text-xs">{source.code}</Badge>
                    {!source.isEnabled && <Badge variant="secondary">已禁用</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{source.baseUrl}</div>
                  <div className="text-xs text-muted-foreground">优先级 {source.priority} · 速率 {source.rateLimit}</div>
                </div>
                <Switch
                  checked={source.isEnabled}
                  onCheckedChange={(v) => toggleSourceEnabled(source.id, v)}
                />
              </div>
              <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => handleMove(index, 'up')}>
                  <ChevronUp className="size-4" /> 上移
                </Button>
                <Button variant="ghost" size="sm" disabled={index === videoSources.length - 1} onClick={() => handleMove(index, 'down')}>
                  <ChevronDown className="size-4" /> 下移
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={() => handleDelete(source.id, source.name)}>
                  <Trash2 className="size-4" /> 删除
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
