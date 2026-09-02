import type { SyncCategory } from '../types';

/** 表 → 数据类别映射（2.12）。类门控 T4 的 push/pull 过滤、enqueueAllForSync、restore 落地均依赖。 */
export const CATEGORY_TABLES: Record<SyncCategory, string[]> = {
  appConfig: ['system_config'],
  marks: ['favorite', 'dislike'],
  history: ['watch_history'],
  progress: ['watch_line_progress'],
  collected: ['media', 'episode', 'play_source', 'video_source'],
  preference: ['hidden_genre', 'user_interest_tag'],
};

export function tableToCategory(table: string): SyncCategory | null {
  for (const [cat, tables] of Object.entries(CATEGORY_TABLES)) {
    if (tables.includes(table)) return cat as SyncCategory;
  }
  return null;
}

/** 某类别是否开启 */
export function categoryEnabled(categories: Record<SyncCategory, boolean>, table: string): boolean {
  const cat = tableToCategory(table);
  if (!cat) return false;
  return categories[cat] !== false;
}