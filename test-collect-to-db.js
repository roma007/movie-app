const axios = require('axios');
const sqlite3 = require('sqlite3');
const path = require('path');

const DB_PATH = '/Users/mengfeng/Library/Application Support/com.movie.app.desktop/movieapp.db';

async function getDetail(baseUrl, vodId) {
  const url = `${baseUrl}?ac=detail&ids=${vodId}`;
  console.log(`获取详情: ${url}`);
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 15000,
  });
  return response.data;
}

async function collectAndInsert() {
  console.log('=== 开始采集测试 ===');
  
  const db = new sqlite3.Database(DB_PATH);
  
  try {
    const sources = [
      { id: 'source_mdzuzi', baseUrl: 'https://www.mdzyapi.com/api.php/provide/vod' },
    ];
    
    let totalInserted = 0;
    
    for (const source of sources) {
      console.log(`\n处理源: ${source.id}`);
      
      const listUrl = `${source.baseUrl}?ac=list&pg=1&limit=5`;
      console.log(`获取列表: ${listUrl}`);
      
      const listResponse = await axios.get(listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000,
      });
      
      const list = listResponse.data.list || [];
      console.log(`列表长度: ${list.length}`);
      
      for (const listItem of list) {
        try {
          const detailResponse = await getDetail(source.baseUrl, listItem.vod_id);
          const detailList = detailResponse.list || [];
          
          if (detailList.length === 0) {
            console.log(`跳过: ${listItem.vod_name} (无详情)`);
            continue;
          }
          
          const item = detailList[0];
          const year = parseInt(item.vod_year) || 2026;
          
          if (year < 2025) {
            console.log(`跳过: ${item.vod_name} (年份 ${year} < 2025)`);
            continue;
          }
          
          const fingerprint = `${source.id}_${item.vod_id}`;
          
          const existing = await new Promise((resolve) => {
            db.get('SELECT id FROM media WHERE fingerprint = ?', [fingerprint], (err, row) => {
              resolve(row ? true : false);
            });
          });
          
          if (existing) {
            console.log(`跳过: ${item.vod_name} (已存在)`);
            continue;
          }
          
          const mediaId = `media_${item.vod_id}`;
          const now = new Date().toISOString();
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO media (id, title, original_title, type, year, area, genre, director, cast, description, poster_url, status, fingerprint, current_episodes, total_episodes, is_short_drama, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                mediaId,
                item.vod_name,
                item.vod_sub || item.vod_name,
                item.type_name || '其他',
                year,
                item.vod_area || '',
                item.vod_tag || '',
                item.vod_director || '',
                item.vod_actor || '',
                item.vod_blurb || '',
                item.vod_pic || '',
                item.vod_status === 1 ? '播放中' : '已完结',
                fingerprint,
                parseInt(item.vod_total) || 0,
                parseInt(item.vod_total) || 0,
                0,
                now,
                now,
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          
          console.log(`插入成功: ${item.vod_name} (${year})`);
          totalInserted++;
        } catch (err) {
          console.error(`处理失败: ${listItem.vod_name}`, err.message);
        }
      }
    }
    
    console.log(`\n=== 采集完成，共插入 ${totalInserted} 条数据 ===`);
    
    const count = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM media', (err, row) => {
        resolve(row.count);
      });
    });
    
    console.log(`数据库中共有 ${count} 条媒体数据`);
    
  } catch (err) {
    console.error('采集失败:', err.message);
  } finally {
    db.close();
  }
}

collectAndInsert();