#!/usr/bin/env node

/**
 * 从剧集标题获取综艺的最新一期名称
 * 
 * 用法：node scripts/fix-variety-remarks-from-episodes.js
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(process.env.HOME, 'Library', 'Application Support', 'com.movie.app.desktop', 'movieapp.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`数据库文件不存在: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

try {
  // 获取需要修正的综艺（旧格式或无 remarks）
  const varietyList = db.prepare(`
    SELECT m.id, m.title, m.current_episodes
    FROM media m
    WHERE m.type = 'VARIETY' 
      AND (m.remarks IS NULL OR m.remarks = '' OR m.remarks LIKE '%第%期%')
      AND m.current_episodes IS NOT NULL
  `).all();

  console.log(`找到 ${varietyList.length} 条需要修正的综艺`);

  let updated = 0;
  let skipped = 0;
  const updateStmt = db.prepare(`
    UPDATE media SET remarks = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const media of varietyList) {
    // 获取最新剧集
    const latestEpisode = db.prepare(`
      SELECT title FROM episode
      WHERE media_id = ?
      ORDER BY episode_number DESC
      LIMIT 1
    `).get(media.id);

    if (latestEpisode && latestEpisode.title) {
      // 使用剧集标题作为 remarks
      updateStmt.run(latestEpisode.title, media.id);
      updated++;
      console.log(`✓ ${media.title}: ${latestEpisode.title}`);
    } else {
      skipped++;
      console.log(`- ${media.title}: 无剧集标题`);
    }
  }

  console.log(`\n完成！成功更新 ${updated} 条，跳过 ${skipped} 条`);
} catch (error) {
  console.error('错误:', error);
  process.exit(1);
} finally {
  db.close();
}
