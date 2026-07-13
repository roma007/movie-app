const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.HOME + '/Library/Application Support/com.movie.app.desktop/movieapp.db';
const db = new sqlite3.Database(dbPath);

const sourceMap = {
  'source_mdzuzi': '魔都资源',
  'source_baiduyunziyuan': '百度云资源',
  'source_liangziziyuan': '量子资源',
  'source_wujinziziyuan': '无尽资源',
  'source_hongniuziyuan': '红牛资源',
  'source_dianyingtiantang': '电影天堂',
};

const sourceTypeMap = {
  'modum3u8': '正片',
  'dbm3u8': 'HD',
  'dytt': 'HD中字',
  'dyttm3u8': 'HD中字',
  'liangzi': 'HD中字',
  'lzm3u8': 'HD中字',
  'wjm3u8': 'HD',
  'hnyun': '正片',
  'hnm3u8': '正片',
};

db.serialize(() => {
  db.all(
    `SELECT ps.id, ps.source_id, ps.source_name, v.name AS source_display_name 
     FROM play_source ps 
     JOIN video_source v ON ps.source_id = v.id
     JOIN episode e ON ps.episode_id = e.id
     JOIN media m ON e.media_id = m.id
     WHERE m.type = 'MOVIE'`,
    (err, rows) => {
      if (err) {
        console.error(err);
        db.close();
        return;
      }

      let updated = 0;
      rows.forEach(row => {
        const newSourceName = sourceMap[row.source_id] || row.source_display_name || row.source_name;
        const quality = sourceTypeMap[row.source_name] || '正片';

        db.run(
          'UPDATE play_source SET source_name = ?, quality = ? WHERE id = ?',
          [newSourceName, quality, row.id],
          function(err) {
            if (err) {
              console.error('更新失败:', err);
            } else {
              updated++;
              console.log(`更新: ${row.id} -> source_name=${newSourceName}, quality=${quality}`);
            }
          }
        );
      });

      setTimeout(() => {
        console.log(`\n共更新 ${updated} 条记录`);
        db.close();
      }, 1000);
    }
  );
});