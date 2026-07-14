#!/usr/bin/env node

/**
 * 填充 media 表的 remarks 字段
 * 
 * 用法：
 *   node scripts/fill-remarks.js                    # 使用默认数据库路径
 *   node scripts/fill-remarks.js /path/to/db.sqlite  # 指定数据库路径
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
let DB_PATH;

if (args.length > 0) {
  DB_PATH = args[0];
} else {
  const DB_DIR = path.join(process.env.HOME, 'Library', 'Application Support', 'com.movie.app.desktop');
  DB_PATH = path.join(DB_DIR, 'movieapp.db');
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`数据库文件不存在: ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

try {
  const mediaList = db.prepare(`
    SELECT id, title, type, status, current_episodes, total_episodes, remarks
    FROM media
    WHERE remarks IS NULL OR remarks = ''
  `).all();

  console.log(`找到 ${mediaList.length} 条需要填充 remarks 的记录`);

  if (mediaList.length === 0) {
    console.log('所有记录已有 remarks，无需处理');
    process.exit(0);
  }

  let updated = 0;
  const updateStmt = db.prepare(`
    UPDATE media SET remarks = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  for (const media of mediaList) {
    let remarks = null;

    if (media.status === 'ONGOING') {
      if (media.type === 'VARIETY') {
        if (media.current_episodes) {
          remarks = `更新至第${media.current_episodes}期`;
        }
      } else {
        if (media.current_episodes) {
          remarks = `更新至第${media.current_episodes}集`;
        }
      }
    } else if (media.status === 'COMPLETED') {
      if (media.type === 'VARIETY') {
        if (media.total_episodes) {
          remarks = `共${media.total_episodes}期`;
        }
      } else {
        if (media.total_episodes) {
          remarks = `全${media.total_episodes}集`;
        }
      }
    }

    if (remarks) {
      updateStmt.run(remarks, media.id);
      updated++;
      console.log(`✓ ${media.title} (${media.type}): ${remarks}`);
    } else {
      console.log(`- ${media.title} (${media.type}): 无法生成 remarks`);
    }
  }

  console.log(`\n完成！成功更新 ${updated} 条记录`);
} catch (error) {
  console.error('错误:', error);
  process.exit(1);
} finally {
  db.close();
}
