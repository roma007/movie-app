const axios = require('axios');
const fs = require('fs');
const path = require('path');

const dbPath = path.join('/Users/mengfeng/Library/Application Support/com.movie.app.desktop', 'movieapp.db');

async function runCollection() {
  console.log('=== 测试采集功能（直接写入数据库） ===\n');
  
  try {
    const adapter = axios.create({
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    
    const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
    
    console.log('1. 获取列表数据...');
    const listResponse = await adapter.get(`${baseUrl}?ac=list&pg=1&limit=5`);
    console.log(`   获取到 ${listResponse.data.list.length} 条数据`);
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    let successCount = 0;
    
    for (const listItem of listResponse.data.list) {
      console.log(`\n--- 处理: ${listItem.vod_name} ---`);
      
      try {
        console.log('2. 获取详情...');
        const detailResponse = await adapter.get(`${baseUrl}?ac=detail&ids=${listItem.vod_id}`);
        
        if (!detailResponse.data.list || detailResponse.data.list.length === 0) {
          console.log('   ❌ 获取详情失败');
          continue;
        }
        
        const item = detailResponse.data.list[0];
        
        console.log('3. 解析年份...');
        const year = item.vod_year ? parseInt(String(item.vod_year).match(/(\d{4})/)?.[1] || '0', 10) : 0;
        console.log(`   年份: ${year}`);
        
        if (year < 2025) {
          console.log('   ❌ 年份不满足要求');
          continue;
        }
        
        console.log('4. 判断类型...');
        let mediaType = 'MOVIE';
        const remarks = item.vod_remarks || '';
        if (remarks.includes('集') && (remarks.includes('更新') || remarks.includes('全'))) {
          const epMatch = remarks.match(/(\d+)\s*集/);
          if (epMatch && parseInt(epMatch[1]) > 1) {
            mediaType = 'TV';
          }
        }
        console.log(`   类型: ${mediaType}`);
        
        console.log('5. 生成指纹...');
        const fingerprint = `${mediaType.toLowerCase()}:${item.vod_name}:${year}`;
        console.log(`   指纹: ${fingerprint}`);
        
        console.log('6. 插入数据库...');
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO media (
              id, title, original_title, alias, type, year, area, genre, director, cast,
              description, poster_url, backdrop_url, status, fingerprint,
              current_episodes, total_episodes, is_short_drama, view_count,
              favorite_count, search_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fingerprint) DO UPDATE SET
              title = excluded.title,
              updated_at = excluded.updated_at`,
            [
              `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
              item.vod_name,
              null,
              null,
              mediaType,
              year,
              item.vod_area || null,
              JSON.stringify([]),
              JSON.stringify([]),
              JSON.stringify([]),
              item.vod_content || null,
              item.vod_pic || null,
              null,
              'PUBLISHED',
              fingerprint,
              null,
              null,
              0,
              0,
              0,
              0,
              new Date().toISOString(),
              new Date().toISOString(),
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        
        console.log('   ✅ 插入成功');
        successCount++;
        
      } catch (error) {
        console.log(`   ❌ 处理失败: ${error.message}`);
      }
    }
    
    console.log(`\n=== 统计 ===`);
    console.log(`成功: ${successCount}`);
    
    console.log('\n7. 验证数据库...');
    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM media', (err, row) => {
        if (err) reject(err);
        else {
          console.log(`数据库中媒体数量: ${row.count}`);
          resolve();
        }
      });
    });
    
    await new Promise((resolve, reject) => {
      db.all('SELECT title, type, year FROM media ORDER BY year DESC LIMIT 5', (err, rows) => {
        if (err) reject(err);
        else {
          console.log('\n最新5条数据:');
          rows.forEach((row, i) => {
            console.log(`${i + 1}. ${row.title} (${row.type}, ${row.year})`);
          });
          resolve();
        }
      });
    });
    
    db.close();
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

runCollection();
