const axios = require('axios');

async function testFullCollection() {
  console.log('=== 完整采集流程测试 ===\n');
  
  const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
  const adapter = axios.create({
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  
  try {
    console.log('1. 获取列表数据...');
    const listResponse = await adapter.get(`${baseUrl}?ac=list&pg=1&limit=3`);
    console.log(`   获取到 ${listResponse.data.list.length} 条数据`);
    
    let successCount = 0;
    let skipCount = 0;
    
    for (const listItem of listResponse.data.list) {
      console.log(`\n--- 处理: ${listItem.vod_name} ---`);
      
      try {
        console.log('2. 获取详情...');
        const detailResponse = await adapter.get(`${baseUrl}?ac=detail&ids=${listItem.vod_id}`);
        
        if (!detailResponse.data.list || detailResponse.data.list.length === 0) {
          console.log('   ❌ 获取详情失败');
          skipCount++;
          continue;
        }
        
        const item = detailResponse.data.list[0];
        
        console.log('\n3. 字段检查:');
        console.log(`   vod_year: "${item.vod_year}"`);
        console.log(`   vod_name: "${item.vod_name}"`);
        console.log(`   vod_remarks: "${item.vod_remarks}"`);
        console.log(`   vod_play_from: "${item.vod_play_from}"`);
        console.log(`   vod_play_url: "${item.vod_play_url ? '有数据' : '空'}"`);
        
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
          console.log('   ❌ 年份不满足要求');
          skipCount++;
          continue;
        }
        
        console.log('\n5. 播放链接检查:');
        const hasPlayUrl = item.vod_play_url && item.vod_play_url.length > 0;
        console.log(`   有播放链接: ${hasPlayUrl}`);
        
        if (!hasPlayUrl) {
          console.log('   ❌ 无播放链接');
          skipCount++;
          continue;
        }
        
        console.log('\n6. 播放源解析:');
        const vodPlayFrom = item.vod_play_from || '';
        const vodPlayUrl = item.vod_play_url || '';
        const sources = vodPlayFrom ? vodPlayFrom.split(/\$\$|\$/).filter(Boolean) : [];
        const urlGroups = vodPlayUrl ? vodPlayUrl.split(/\$\$|\$/).filter(Boolean) : [];
        console.log(`   播放源数量: ${sources.length}`);
        console.log(`   剧集组数: ${urlGroups.length}`);
        
        let totalEpisodes = 0;
        for (const group of urlGroups) {
          const epList = group.split(/#/).filter(Boolean);
          totalEpisodes += epList.length;
        }
        console.log(`   总集数: ${totalEpisodes}`);
        
        console.log('\n✅ 通过所有检查');
        successCount++;
        
      } catch (error) {
        console.log(`   ❌ 处理失败: ${error.message}`);
        skipCount++;
      }
    }
    
    console.log(`\n=== 统计 ===`);
    console.log(`成功: ${successCount}`);
    console.log(`跳过: ${skipCount}`);
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

testFullCollection();
