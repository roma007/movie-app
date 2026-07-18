import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Loader2,
  Database,
  Search,
  ChevronRight,
  ChevronDown,
  Plus,
} from 'lucide-react';
import { useAppStore } from '../useAppStore';
import { useToast } from './Layout';
import { SourceImportService, AI_SOURCE_PROMPT, AI_SOURCE_IMPORT_SAMPLE } from '@movie-app/core';
import type { ParsedImportSource } from '@movie-app/core';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function AiSourceImportDialog({ open, onOpenChange, onImported }: Props) {
  const toast = useToast();
  const { batchImportSources, validateImportSources } = useAppStore();

  const [step, setStep] = useState<'prompt' | 'paste' | 'preview'>('prompt');
  const [pastedText, setPastedText] = useState('');
  const [preview, setPreview] = useState<ParsedImportSource[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const reset = () => {
    setStep('prompt');
    setPastedText('');
    setPreview([]);
    setResult(null);
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_SOURCE_PROMPT);
      toast('提示词已复制到剪贴板');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPastedText(text);
      toast('已从剪贴板粘贴');
    } catch {
      toast('无法读取剪贴板，请手动粘贴', 'error');
    }
  };

  const handleParse = async () => {
    if (!pastedText.trim()) {
      toast('请先粘贴 AI 返回的数据', 'error');
      return;
    }
    const parsed = SourceImportService.parseJson(pastedText.trim());
    if (parsed.errors.length > 0) {
      toast(parsed.errors[0].message, 'error');
      return;
    }
    if (parsed.items.length === 0) {
      toast('未解析到有效数据', 'error');
      return;
    }
    const p = await validateImportSources(parsed.items);
    setPreview(p);
    setStep('preview');
  };

  const handleImport = async () => {
    const validItems = preview.filter((p) => p.status === 'valid').map((p) => p.item);
    if (validItems.length === 0) {
      toast('没有可导入的有效视频源', 'error');
      return;
    }
    setImporting(true);
    try {
      const res = await batchImportSources(validItems);
      setResult({ imported: res.imported, skipped: res.skipped });
      if (res.imported > 0) {
        toast(`成功导入 ${res.imported} 个视频源`);
      } else {
        toast(`导入失败，${res.skipped} 个被跳过`, 'error');
      }
    } catch (err: any) {
      toast(`导入失败: ${err.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      if (result && result.imported > 0 && onImported) {
        onImported();
      }
      reset();
    }
    onOpenChange(open);
  };

  const validCount = preview.filter((p) => p.status === 'valid').length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-full max-w-[50vw] max-h-[80vh] flex flex-col gap-0 p-0">
        {step === 'prompt' && (
          <>
            <DialogHeader className="px-6 pt-5 pb-3">
              <DialogTitle>添加视频源</DialogTitle>
              <DialogDescription>
                复制下方提示词，发给 AI 助手（如 ChatGPT、Claude 等），再将 AI 返回的结果粘贴到下一步
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
              <pre className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-4 whitespace-pre-wrap break-all max-h-[360px] overflow-y-auto font-sans leading-relaxed">
                {AI_SOURCE_PROMPT}
              </pre>
            </div>
            <Separator />
            <div className="flex justify-end gap-3 px-6 py-3">
              <Button variant="outline" onClick={() => handleClose(false)}>取消</Button>
              <Button onClick={handleCopyPrompt}>
                <CheckCircle2 className="size-4 mr-1" /> 复制提示词
              </Button>
              <Button onClick={() => setStep('paste')}>
                下一步 <ChevronRight className="size-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {step === 'paste' && (
          <>
            <DialogHeader className="px-6 pt-5 pb-3">
              <DialogTitle>粘贴 AI 返回的数据</DialogTitle>
              <DialogDescription>
                将 AI 返回的 JSON 数据粘贴到下方文本框中，然后点击解析
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
              <div className="flex gap-2 mb-3">
                <Button variant="outline" size="sm" onClick={handleClipboardPaste}>
                  <Plus className="size-3 mr-1" /> 从剪贴板粘贴
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPastedText(AI_SOURCE_IMPORT_SAMPLE)}>
                  查看示例
                </Button>
              </div>
              <textarea
                className="w-full h-[300px] bg-muted/50 rounded-lg p-4 text-xs font-mono resize-none outline-none focus:ring-1 focus:ring-primary"
                placeholder="在此粘贴 AI 返回的 JSON 数据..."
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
              />
            </div>
            <Separator />
            <div className="flex justify-end gap-3 px-6 py-3">
              <Button variant="outline" onClick={() => setStep('prompt')}>
                <ChevronDown className="size-4 mr-1 rotate-90" /> 返回
              </Button>
              <Button onClick={handleParse}>
                <Search className="size-4 mr-1" /> 解析并预览
              </Button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <DialogHeader className="px-6 pt-5 pb-3">
              <DialogTitle>预览导入结果</DialogTitle>
              <DialogDescription>
                {result
                  ? `导入完成：成功 ${result.imported} 个${result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''}`
                  : `共解析 ${preview.length} 个视频源，${validCount} 个可导入`
                }
              </DialogDescription>
            </DialogHeader>
            <Separator />
            <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
              {result ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                  <CheckCircle2 className="size-10 text-green-500" />
                  <p className="text-lg font-medium text-green-500">成功导入 {result.imported} 个视频源</p>
                  {result.skipped > 0 && <p className="text-sm text-muted-foreground">{result.skipped} 个被跳过</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  {preview.map((p, idx) => {
                    const icon = p.status === 'valid' ? '✅' : p.status === 'invalid_field' ? '❌' : '⚠️';
                    const isOverwrite = p.status === 'code_exists' || p.status === 'url_exists';
                    return (
                      <div
                        key={idx}
                        className={`flex items-center gap-3 p-3 rounded-md border ${
                          p.status === 'valid' ? 'border-green-500/30 bg-green-500/5'
                          : isOverwrite ? 'border-yellow-500/30 bg-yellow-500/5'
                          : 'border-red-500/30 bg-red-500/5'
                        }`}
                      >
                        <span className="text-lg">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{p.item.name || '未命名'}</span>
                            <Badge variant="outline" className="text-[10px]">{p.item.code}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">{p.item.baseUrl}</div>
                          {p.errors.length > 0 && <div className="text-xs text-red-500 mt-0.5">{p.errors[0]}</div>}
                          {p.existingSource && (
                            <div className="text-xs text-yellow-500 mt-0.5">
                              已在库: {p.existingSource.name}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <Separator />
            <div className="flex justify-end gap-3 px-6 py-3">
              {result ? (
                <Button onClick={() => handleClose(false)}>完成</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep('paste')}>
                    <ChevronDown className="size-4 mr-1 rotate-90" /> 返回修改
                  </Button>
                  <Button onClick={handleImport} disabled={importing || validCount === 0}>
                    {importing ? (
                      <><Loader2 className="size-4 mr-1 animate-spin" /> 导入中...</>
                    ) : (
                      <><Database className="size-4 mr-1" /> 导入 {validCount} 个视频源</>
                    )}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
