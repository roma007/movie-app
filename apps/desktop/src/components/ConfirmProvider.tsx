import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, X } from 'lucide-react';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface DialogState extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    title: '',
  });

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, open: true, resolve });
    });
  }, []);

  const handleClose = (result: boolean) => {
    state.resolve?.(result);
    setState((prev) => ({ ...prev, open: false }));
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleClose(false); }}>
        <DialogContent className="w-full max-w-[45vw]">
          <DialogClose className="absolute right-3 top-3 p-1 rounded-sm opacity-70 hover:opacity-100 hover:bg-accent">
            <X className="h-4 w-4" />
          </DialogClose>

          <div className="pt-8 pb-6 px-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              {state.variant === 'destructive' ? (
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <DialogTitle className="text-base font-semibold text-foreground">
                  {state.title}
                </DialogTitle>
                {state.description && (
                  <DialogDescription className="text-sm text-muted-foreground leading-relaxed mt-1">
                    {state.description}
                  </DialogDescription>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleClose(false)}
                className="h-8 px-4 text-sm"
              >
                {state.cancelText || '取消'}
              </Button>
              <Button
                variant={state.variant === 'destructive' ? 'destructive' : 'default'}
                size="sm"
                onClick={() => handleClose(true)}
                className="h-8 px-4 text-sm"
              >
                {state.confirmText || '确定'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    return (options) => Promise.resolve(window.confirm(options.title));
  }
  return fn;
}
