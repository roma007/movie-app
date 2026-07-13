const axios = require('axios');

async function testCollection() {
  console.log('=== 开始测试采集流程 ===\n');
  
  const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
  
  try {
    console.log('1. 获取列表数据...');
    const listResponse = await axios.get(`${baseUrl}?ac=list&pg=1&limit=3`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
    
    console.log(`   获取到 ${listResponse.data.list.length} 条数据`);
    
    for (const listItem of listResponse.data.list) {
      console.log(`\n--- 测试项目: ${listItem.vod_name} (ID: ${listItem.vod_id}) ---`);
      
      console.log('2. 获取详情数据...');
      const detailResponse = await axios.get(`${baseUrl}?ac=detail&ids=${listItem.vod_id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000
      });
      
      if (!detailResponse.data.list || detailResponse.data.list.length === 0) {
        console.log('   ❌ 获取详情失败');
        continue;
      }
      
      const item = detailResponse.data.list[0];
      console.log(`   ✅ 成功获取详情`);
      
      console.log('\n3. 检查关键字段:');
      console.log(`   vod_year: "${item.vod_year}"`);
      console.log(`   vod_name: "${item.vod_name}"`);
      console.log(`   vod_type: "${item.vod_type}"`);
      console.log(`   vod_remarks: "${item.vod_remarks}"`);
      console.log(`   vod_play_from: "${item.vod_play_from}"`);
      console.log(`   vod_play_url: "${item.vod_play_url ? '有数据' : '空'}"`);
      
      console.log('\n4. 测试年份解析...');
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
      console.log(`   解析结果: ${year}`);
      
      if (!year) {
        console.log('   ❌ 年份解析失败，数据被跳过');
        continue;
      }
      
      console.log('\n✅ 项目通过所有检查，可以采集!');
    }
    
    console.log('\n=== 测试完成 ===');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

testCollection();
