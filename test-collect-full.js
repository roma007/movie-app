const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testFullCollection() {
  console.log('=== 开始完整采集流程测试 ===\n');
  
  const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
  const dbPath = path.join(__dirname, 'test-collect.db');
  
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('清理旧测试数据库');
    }
    
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database(dbPath);
    
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          original_title TEXT,
          type TEXT NOT NULL,
          year INTEGER NOT NULL,
          area TEXT,
          genres TEXT,
          directors TEXT,
          actors TEXT,
          description TEXT,
          poster_url TEXT,
          status TEXT DEFAULT 'PUBLISHED',
          fingerprint TEXT UNIQUE,
          view_count INTEGER DEFAULT 0,
          created_at TEXT,
          updated_at TEXT
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log('1. 获取列表数据...');
    const listResponse = await axios.get(`${baseUrl}?ac=list&pg=1&limit=5`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    
    console.log(`   获取到 ${listResponse.data.list.length} 条数据`);
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (const listItem of listResponse.data.list) {
      console.log(`\n--- 处理: ${listItem.vod_name} (ID: ${listItem.vod_id}) ---`);
      
      try {
        console.log('2. 获取详情数据...');
        const detailResponse = await axios.get(`${baseUrl}?ac=detail&ids=${listItem.vod_id}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 15000
        });
        
        if (!detailResponse.data.list || detailResponse.data.list.length === 0) {
          console.log('   ❌ 获取详情失败');
          failCount++;
          continue;
        }
        
        const item = detailResponse.data.list[0];
        console.log('   ✅ 获取详情成功');
        
        console.log('\n3. 解析字段:');
        console.log(`   vod_year: "${item.vod_year}"`);
        console.log(`   vod_name: "${item.vod_name}"`);
        console.log(`   vod_type: "${item.vod_type}"`);
        console.log(`   vod_remarks: "${item.vod_remarks}"`);
        console.log(`   vod_area: "${item.vod_area}"`);
        
        console.log('\n4. 年份解析:');
        let year = null;
        if (item.vod_year) {
          const str = String(item.vod_year);
          if (!str.startsWith('-')) {
            const match = str.match(/(\d{4})/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num >= 2025) {
                year = num;
              }
            }
          }
        }
        console.log(`   结果: ${year}`);
        
        if (!year) {
          console.log('   ❌ 年份不满足要求，跳过');
          skipCount++;
          continue;
        }
        
        console.log('\n5. 类型映射:');
        let mediaType = 'MOVIE';
        const typeName = item.vod_type || '';
        const remarks = item.vod_remarks || '';
        
        if (remarks.includes('集') && (remarks.includes('更新') || remarks.includes('全'))) {
          const epMatch = remarks.match(/(\d+)\s*集/);
          if (epMatch && parseInt(epMatch[1]) > 1) {
            mediaType = 'TV';
          }
        }
        
        console.log(`   结果: ${mediaType}`);
        
        console.log('\n6. 生成指纹:');
        const fingerprint = `${mediaType.toLowerCase()}:${item.vod_name}:${year}`;
        console.log(`   指纹: ${fingerprint}`);
        
        console.log('\n7. 插入数据库...');
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR IGNORE INTO media (id, title, type, year, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [`id_${Date.now()}`, item.vod_name, mediaType, year, fingerprint, new Date().toISOString(), new Date().toISOString()],
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
        failCount++;
      }
    }
    
    console.log(`\n=== 测试统计 ===`);
    console.log(`成功: ${successCount}`);
    console.log(`跳过: ${skipCount}`);
    console.log(`失败: ${failCount}`);
    
    await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM media', (err, row) => {
        if (err) reject(err);
        else {
          console.log(`\n数据库中媒体数量: ${row.count}`);
          resolve();
        }
      });
    });
    
    db.close();
    
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('\n清理测试数据库');
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

testFullCollection();
