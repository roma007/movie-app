import { NavLink, Outlet } from 'react-router-dom';
import {
  Home,
  Search,
  Heart,
  History,
  Database,
  Settings,
  Film,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/favorites', label: '收藏', icon: Heart },
  { to: '/history', label: '历史', icon: History },
  { to: '/sources', label: '视频源', icon: Database },
  { to: '/settings', label: '设置', icon: Settings },
];

export function Layout() {
  return (
    <div className="flex h-full">
      {/* 侧边栏 */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-[#161616]">
        <div className="flex items-center gap-2 px-5 h-14 border-b border-border">
          <Film className="size-5 text-primary" />
          <span className="font-semibold tracking-tight">Movie App</span>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-5 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary border-l-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-l-2 border-transparent'
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
          版本 1.0.0
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
