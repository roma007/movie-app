const axios = require('axios');
const fs = require('fs');
const path = require('path');

const dbPath = path.join('/Users/mengfeng/Library/Application Support/com.movie.app.desktop', 'movieapp.db');

async function runCollection() {
  console.log('=== 测试采集功能 ===\n');
  
  try {
    const adapter = axios.create({
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    
    const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
    
    console.log('1. 获取列表数据...');
    const listResponse = await adapter.get(`${baseUrl}?ac=list&pg=1&limit=5`);
    console.log(`   获取到 ${listResponse.data.list.length} 条数据`);
    
    let successCount = 0;
    let skipCount = 0;
    
    for (const listItem of listResponse.data.list) {
      console.log(`\n--- 处理: ${listItem.vod_name} ---`);
      
      console.log('2. 获取详情...');
      const detailResponse = await adapter.get(`${baseUrl}?ac=detail&ids=${listItem.vod_id}`);
      
      if (!detailResponse.data.list || detailResponse.data.list.length === 0) {
        console.log('   ❌ 获取详情失败');
        continue;
      }
      
      const item = detailResponse.data.list[0];
      
      console.log('3. 检查年份...');
      const year = item.vod_year ? parseInt(String(item.vod_year).match(/(\d{4})/)?.[1] || '0', 10) : 0;
      console.log(`   年份: ${year}`);
      
      if (year < 2025) {
        console.log('   ❌ 年份不满足要求');
        skipCount++;
        continue;
      }
      
      console.log('4. 检查播放链接...');
      const hasPlayUrl = item.vod_play_url && item.vod_play_url.length > 0;
      console.log(`   播放链接: ${hasPlayUrl ? '有' : '无'}`);
      
      if (!hasPlayUrl) {
        console.log('   ❌ 无播放链接');
        skipCount++;
        continue;
      }
      
      console.log('✅ 通过检查');
      successCount++;
    }
    
    console.log(`\n=== 统计 ===`);
    console.log(`成功: ${successCount}`);
    console.log(`跳过: ${skipCount}`);
    
    console.log('\n5. 检查数据库...');
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM media', (err, row) => {
        if (err) reject(err);
        else {
          console.log(`数据库中媒体数量: ${row.count}`);
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
