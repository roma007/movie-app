import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Copy, Trash2 } from 'lucide-react';

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export function ContextMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    const selection = window.getSelection();
    const hasSelection = !!selection && selection.toString().length > 0;
    let isEditable = false;
    if (hasSelection && selection && selection.rangeCount > 0) {
      const node = selection.getRangeAt(0).startContainer;
      const el = node.nodeType === Node.ELEMENT_NODE
        ? node as Element
        : node.parentElement;
      isEditable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    }
    setMenuItems([
      {
        label: '刷新',
        icon: <RefreshCw className="w-3.5 h-3.5" />,
        onClick: () => window.location.reload(),
      },
      {
        label: '复制',
        icon: <Copy className="w-3.5 h-3.5" />,
        disabled: !hasSelection,
        onClick: () => {
          if (selection && selection.toString()) {
            navigator.clipboard.writeText(selection.toString()).catch(() => {});
          }
          setIsOpen(false);
        },
      },
      {
        label: '删除',
        icon: <Trash2 className="w-3.5 h-3.5" />,
        disabled: !isEditable,
        onClick: () => {
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
          }
          setIsOpen(false);
        },
      },
    ]);
    setIsOpen(true);
  }, []);

  const handleClick = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleContextMenu, handleClick, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed z-50 w-40 py-1 bg-popover border border-border rounded-lg shadow-lg"
      style={{
        left: Math.min(position.x, window.innerWidth - 160),
        top: Math.min(position.y, window.innerHeight - 200),
      }}
    >
      {menuItems.map((item, index) => (
        <button
          key={index}
          className={`w-full px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent transition-colors ${
            item.disabled ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground'
          }`}
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
