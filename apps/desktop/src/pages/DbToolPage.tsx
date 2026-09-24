import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Database,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Link2,
  Zap,
  Table2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/Layout';
import { getProvider } from '../init';

type OverviewTable = { name: string; kind: 'table' | 'view' | 'fts' | 'shadow'; rowCount: number };
type InspectorOverview = {
  tables: OverviewTable[];
  pageSize: number;
  pageCount: number;
  dbSizeBytes: number;
  journalMode: string;
};
type TableDetail = {
  columns: { cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number }[];
  indexes: { seq: number; name: string; unique: number; origin: string; partial: number; cols: string[] }[];
  foreignKeys: { id: number; seq: number; table: string; from: string; to: string | null; on_update: string; on_delete: string; match: string }[];
  triggers: { name: string; sql: string | null }[];
};
type TableData = {
  columns: string[];
  rows: any[][];
  rowCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const PAGE_SIZE = 100;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function kindLabel(kind: OverviewTable['kind']): { text: string; cls: string } {
  switch (kind) {
    case 'view': return { text: '视图', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'fts': return { text: 'FTS', cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
    case 'shadow': return { text: '辅助表', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
    default: return { text: '表', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  }
}

function formatCell(value: any): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const isLong = s.length > 120;
  return (
    <span
      title={isLong ? s : undefined}
      className="inline-block max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap align-bottom"
    >
      {isLong ? `${s.slice(0, 120)}…` : s}
    </span>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: any[][] }) {
  return (
    <div className="overflow-auto rounded-md border bg-[var(--color-card-alpha)]">
      <table className="w-full text-sm" style={{ minWidth: Math.max(480, columns.length * 110) }}>
        <thead>
          <tr className="border-b bg-muted/60">
            <th className="sticky top-0 bg-muted/60 px-3 py-2 text-left font-medium text-muted-foreground w-16">#</th>
            {columns.map((c) => (
              <th key={c} className="sticky top-0 bg-muted/60 px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                无数据
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className={cn('border-b last:border-0 hover:bg-hover/50', i % 2 === 1 && 'bg-muted/20')}>
                <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5">
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DbToolPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [overview, setOverview] = useState<InspectorOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [data, setData] = useState<TableData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [section, setSection] = useState<'structure' | 'data'>('structure');
  const [pageJump, setPageJump] = useState('');
  const [sqlText, setSqlText] = useState(
    '-- 只读模式：仅允许 SELECT / WITH / EXPLAIN / 白名单 PRAGMA\n-- 示例：最近更新的 20 部影视\nSELECT id, title, type, year, area, updated_at FROM media ORDER BY updated_at DESC LIMIT 20'
  );
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: any[][]; elapsed: number } | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const ov = await getProvider().getInspectorOverview();
      setOverview(ov);
    } catch (e: any) {
      setOverviewError(e?.message || String(e));
      toast('加载库概览失败：' + (e?.message || String(e)), 'error');
    } finally {
      setOverviewLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadDetail = useCallback(async (table: string) => {
    setDetailLoading(true);
    try {
      const d = await getProvider().getInspectorTableDetail(table);
      setDetail(d);
    } catch (e: any) {
      toast('加载表结构失败：' + (e?.message || String(e)), 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const loadData = useCallback(async (table: string, page: number) => {
    setDataLoading(true);
    try {
      const d = await getProvider().getInspectorTableData(table, page, PAGE_SIZE);
      setData(d);
    } catch (e: any) {
      toast('加载表数据失败：' + (e?.message || String(e)), 'error');
    } finally {
      setDataLoading(false);
    }
  }, [toast]);

  const handleSelectTable = useCallback((name: string) => {
    setSelectedTable(name);
    setSection('structure');
    setDetail(null);
    setData(null);
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    loadDetail(selectedTable);
    loadData(selectedTable, 1);
  }, [selectedTable, loadDetail, loadData, overview]);

  const runSql = useCallback(async () => {
    setSqlError(null);
    setSqlRunning(true);
    const start = Date.now();
    try {
      const r = await getProvider().runInspectorQuery(sqlText);
      setSqlResult({ ...r, elapsed: Date.now() - start });
    } catch (e: any) {
      setSqlResult(null);
      setSqlError(e?.message || String(e));
    } finally {
      setSqlRunning(false);
    }
  }, [sqlText]);

  const handleJumpPage = useCallback(() => {
    if (!selectedTable || !data) return;
    const p = parseInt(pageJump, 10);
    if (!Number.isNaN(p) && p >= 1 && p <= data.totalPages) {
      loadData(selectedTable, p);
    }
    setPageJump('');
  }, [selectedTable, data, pageJump, loadData]);

  const filteredTables = overview?.tables.filter((t) =>
    t.name.toLowerCase().includes(tableFilter.trim().toLowerCase())
  ) ?? [];

  const statSummary = overview
    ? `${overview.tables.length} 个对象 · 主库 ${formatBytes(overview.dbSizeBytes)} · journal=${overview.journalMode}`
    : '';

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pt-4 pb-2 gap-3">
      <header className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} title="返回">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Database className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold tracking-tight">数据库工具</h1>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="size-3" />
            只读
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-auto">
          {overviewLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span>{statSummary}</span>
          )}
          <Button variant="outline" size="sm" onClick={loadOverview} disabled={overviewLoading}>
            <RefreshCw className={cn('size-4', overviewLoading && 'animate-spin')} />
            刷新
          </Button>
        </div>
      </header>

      <Tabs defaultValue="browse" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="browse" className="gap-1.5">
            <Table2 className="size-4" />
            数据浏览
          </TabsTrigger>
          <TabsTrigger value="sql" className="gap-1.5">
            <TerminalSquare className="size-4" />
            SQL 查询
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <aside className="flex w-72 shrink-0 flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="筛选表名…"
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto pr-1">
              {overviewLoading ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  <Loader2 className="mx-auto mb-1 size-4 animate-spin" />
                  统计行数中…（大表可能需要数秒）
                </div>
              ) : overviewError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {overviewError}
                </div>
              ) : filteredTables.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">无匹配对象</div>
              ) : (
                filteredTables.map((t) => {
                  const k = kindLabel(t.kind);
                  return (
                    <button
                      key={t.name}
                      onClick={() => handleSelectTable(t.name)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                        selectedTable === t.name ? 'bg-muted-foreground/20 text-text' : 'text-text-secondary hover:bg-hover hover:text-text'
                      )}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        {t.kind === 'view' ? <Layers className="size-3.5 shrink-0 text-muted-foreground" /> : t.kind === 'fts' ? <Zap className="size-3.5 shrink-0 text-purple-400/70" /> : <Database className="size-3.5 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{t.name}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {t.rowCount < 0 ? '—' : t.rowCount.toLocaleString()}
                      </span>
                      <span className={cn('shrink-0 rounded border px-1 py-px text-[9px] leading-none', k.cls)}>{k.text}</span>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {!selectedTable ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                ← 从左侧选择一个表查看结构 / 数据
              </div>
            ) : (
              <>
                <header className="flex shrink-0 flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{selectedTable}</h2>
                  {overview && (() => {
                    const st = overview.tables.find((t) => t.name === selectedTable);
                    if (!st) return null;
                    const k = kindLabel(st.kind);
                    return (
                      <>
                        <span className={cn('rounded border px-1.5 py-px text-[10px] leading-none', k.cls)}>{k.text}</span>
                        <span className="text-xs text-muted-foreground">
                          {st.rowCount < 0 ? '行数不可统计' : `共 ${st.rowCount.toLocaleString()} 行`}
                        </span>
                      </>
                    );
                  })()}
                  <Tabs value={section} onValueChange={(v) => setSection(v as 'structure' | 'data')} className="ml-auto">
                    <TabsList className="h-8">
                      <TabsTrigger value="structure" className="px-2.5 text-xs">结构</TabsTrigger>
                      <TabsTrigger value="data" className="px-2.5 text-xs">数据</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </header>

                {section === 'structure' ? (
                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                    {detailLoading ? (
                      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> 加载表结构…
                      </div>
                    ) : detail ? (
                      <>
                        <div>
                          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            字段（{detail.columns.length}）
                          </h3>
                          <Card className="overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                                  <th className="px-3 py-2 font-medium">字段名</th>
                                  <th className="px-3 py-2 font-medium">类型</th>
                                  <th className="px-3 py-2 font-medium">主键</th>
                                  <th className="px-3 py-2 font-medium">NOT NULL</th>
                                  <th className="px-3 py-2 font-medium">默认值</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.columns.map((c) => (
                                  <tr key={c.cid} className="border-b last:border-0 hover:bg-hover/50">
                                    <td className="px-3 py-1.5 font-medium">{c.name}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{c.type || '—'}</td>
                                    <td className="px-3 py-1.5">
                                      {c.pk > 0 ? (
                                        <span className="inline-flex items-center gap-1 text-amber-400">
                                          <KeyRound className="size-3" /> PK{c.pk > 1 ? `(${c.pk})` : ''}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{c.notnull ? '✓' : ''}</td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{c.dflt_value === null ? '—' : formatCell(c.dflt_value)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </Card>
                        </div>

                        <div>
                          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            索引（{detail.indexes.length}）
                          </h3>
                          <Card className="overflow-hidden">
                            {detail.indexes.length === 0 ? (
                              <div className="px-3 py-4 text-sm text-muted-foreground">无索引</div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                                    <th className="px-3 py-2 font-medium">索引名</th>
                                    <th className="px-3 py-2 font-medium">唯一</th>
                                    <th className="px-3 py-2 font-medium">来源</th>
                                    <th className="px-3 py-2 font-medium">部分</th>
                                    <th className="px-3 py-2 font-medium">字段</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.indexes.map((ix) => (
                                    <tr key={ix.seq} className="border-b last:border-0 hover:bg-hover/50">
                                      <td className="px-3 py-1.5 font-medium">{ix.name}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{ix.unique ? '✓' : ''}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{ix.origin}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{ix.partial ? '✓' : ''}</td>
                                      <td className="px-3 py-1.5">{ix.cols.join(', ')}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </Card>
                        </div>

                        <div>
                          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            外键（{detail.foreignKeys.length}）
                          </h3>
                          <Card className="overflow-hidden">
                            {detail.foreignKeys.length === 0 ? (
                              <div className="px-3 py-4 text-sm text-muted-foreground">无外键</div>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                                    <th className="px-3 py-2 font-medium">字段</th>
                                    <th className="px-3 py-2 font-medium">引用表</th>
                                    <th className="px-3 py-2 font-medium">引用字段</th>
                                    <th className="px-3 py-2 font-medium">更新</th>
                                    <th className="px-3 py-2 font-medium">删除</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.foreignKeys.map((fk, i) => (
                                    <tr key={i} className="border-b last:border-0 hover:bg-hover/50">
                                      <td className="px-3 py-1.5 font-medium">{fk.from}</td>
                                      <td className="px-3 py-1.5">
                                        <span className="inline-flex items-center gap-1">
                                          <Link2 className="size-3 text-muted-foreground" /> {fk.table}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{fk.to || '—'}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{fk.on_update}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{fk.on_delete}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </Card>
                        </div>

                        <div>
                          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            触发器（{detail.triggers.length}）
                          </h3>
                          <Card className="overflow-hidden">
                            {detail.triggers.length === 0 ? (
                              <div className="px-3 py-4 text-sm text-muted-foreground">无触发器</div>
                            ) : (
                              <div className="divide-y">
                                {detail.triggers.map((tr) => (
                                  <div key={tr.name} className="p-3">
                                    <div className="flex items-center gap-1.5 text-sm font-medium">
                                      <Zap className="size-3.5 text-amber-400/80" />
                                      {tr.name}
                                    </div>
                                    <pre className="mt-1.5 overflow-x-auto rounded bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
                                      {tr.sql}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </Card>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        共 {data?.rowCount && data.rowCount > 0 ? data.rowCount.toLocaleString() : '—'} 行
                      </span>
                      <span className="mx-1 opacity-50">|</span>
                      <span>每页 {PAGE_SIZE} 行</span>
                      <span className="flex-1" />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!data || data.page <= 1 || dataLoading}
                        onClick={() => selectedTable && data && loadData(selectedTable, data.page - 1)}
                      >
                        <ChevronLeft className="size-4" /> 上一页
                      </Button>
                      <span className="whitespace-nowrap">
                        {data ? `${data.page} / ${data.totalPages}` : '—'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!data || data.page >= data.totalPages || dataLoading}
                        onClick={() => selectedTable && data && loadData(selectedTable, data.page + 1)}
                      >
                        下一页 <ChevronRight className="size-4" />
                      </Button>
                      <Input
                        className="h-8 w-20"
                        placeholder="跳页"
                        value={pageJump}
                        onChange={(e) => setPageJump(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleJumpPage(); }}
                      />
                      <Button variant="ghost" size="sm" onClick={handleJumpPage} disabled={!data}>
                        <Plus className="size-3" /> 跳转
                      </Button>
                    </div>
                    {dataLoading ? (
                      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> 加载数据…
                      </div>
                    ) : data ? (
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <DataTable columns={data.columns} rows={data.rows} />
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </section>
        </TabsContent>

        <TabsContent value="sql" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <Card className="shrink-0 p-3">
            <textarea
              className="min-h-[150px] w-full resize-y rounded-md border bg-[var(--color-input-alpha)] p-3 font-mono text-sm text-text outline-none focus-visible:outline-none"
              value={sqlText}
              onChange={(e) => setSqlText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  runSql();
                }
              }}
              placeholder="输入只读 SQL（SELECT / WITH / EXPLAIN / 白名单 PRAGMA）…"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={runSql} disabled={sqlRunning}>
                {sqlRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                运行
              </Button>
              <span className="text-xs text-muted-foreground">快捷键 ⌘/Ctrl + Enter</span>
              {sqlResult && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {sqlResult.rows.length} 行 · {sqlResult.elapsed} ms
                </span>
              )}
            </div>
            {sqlError && (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {sqlError}
              </div>
            )}
          </Card>
          {sqlResult && sqlResult.rows.length > 0 && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <DataTable columns={sqlResult.columns} rows={sqlResult.rows} />
            </div>
          )}
          {sqlResult && sqlResult.rows.length === 0 && (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              查询无结果（{sqlResult.elapsed} ms）
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}