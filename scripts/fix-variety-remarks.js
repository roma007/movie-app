#!/usr/bin/env node

/**
 * 修正综艺类型的 remarks 字段
 * 
 * 从 CMS 获取正确的 remarks（如"更新至2024年最新一期"）
 * 
 * 用法：node scripts/fix-variety-remarks.js
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

async function fetchFromCMS(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchVarietyRemarks(title, baseUrl) {
  try {
    const encodedTitle = encodeURIComponent(title);
    const url = `${baseUrl}?ac=videolist&wd=${encodedTitle}&pg=1`;
    const data = await fetchFromCMS(url);
    
    if (data.code === 1 && data.list && data.list.length > 0) {
      // 找到最匹配的（标题完全相同）
      const exactMatch = data.list.find(item => item.vod_name === title);
      if (exactMatch) {
        return exactMatch.vod_remarks || null;
      }
      // 如果没有完全匹配，返回第一个
      return data.list[0].vod_remarks || null;
    }
    return null;
  } catch (error) {
    console.error(`  搜索失败: ${error.message}`);
    return null;
  }
}

async function main() {
  try {
    // 获取所有综艺类型且有 current_episodes 的记录（只处理需要修正的）
    const varietyList = db.prepare(`
      SELECT id, title, status, current_episodes, remarks
      FROM media
      WHERE type = 'VARIETY' AND current_episodes IS NOT NULL
        AND (remarks IS NULL OR remarks LIKE '%第%期%')
    `).all();

    console.log(`找到 ${varietyList.length} 条综艺记录`);

    // 获取启用的视频源
    const sources = db.prepare(`
      SELECT base_url FROM video_source WHERE is_enabled = 1
    `).all();

    if (sources.length === 0) {
      console.error('没有启用的视频源');
      process.exit(1);
    }

    const baseUrl = sources[0].base_url;
    console.log(`使用视频源: ${baseUrl}`);

    let updated = 0;
    let failed = 0;
    const updateStmt = db.prepare(`
      UPDATE media SET remarks = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    for (const media of varietyList) {
      console.log(`\n处理: ${media.title}`);
      
      // 如果已有正确的 remarks（不包含"第X期"），跳过
      if (media.remarks && !media.remarks.match(/第\d+期$/)) {
        console.log(`  已有正确 remarks: ${media.remarks}`);
        continue;
      }

      const remarks = await searchVarietyRemarks(media.title, baseUrl);
      
      if (remarks) {
        updateStmt.run(remarks, media.id);
        updated++;
        console.log(`✓ 更新为: ${remarks}`);
      } else {
        failed++;
        console.log(`- 无法获取 remarks`);
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n完成！成功更新 ${updated} 条，失败 ${failed} 条`);
  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
