const axios = require('axios');

async function testApi() {
  const baseUrl = 'https://www.mdzyapi.com/api.php/provide/vod';
  
  try {
    console.log('=== 测试列表接口 ===');
    const listUrl = `${baseUrl}?ac=list&pg=1&limit=5`;
    console.log(`请求: ${listUrl}`);
    const listResponse = await axios.get(listUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 15000,
    });
    console.log('列表响应:', JSON.stringify(listResponse.data, null, 2).substring(0, 1000));
    
    const list = listResponse.data.list || [];
    console.log(`列表长度: ${list.length}`);
    
    if (list.length > 0) {
      const firstItem = list[0];
      console.log('\n=== 测试详情接口 ===');
      const detailUrl = `${baseUrl}?ac=detail&ids=${firstItem.vod_id}`;
      console.log(`请求: ${detailUrl}`);
      const detailResponse = await axios.get(detailUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000,
      });
      console.log('详情响应:', JSON.stringify(detailResponse.data, null, 2).substring(0, 2000));
      
      const detailList = detailResponse.data.list || [];
      console.log(`详情列表长度: ${detailList.length}`);
      
      if (detailList.length > 0) {
        const item = detailList[0];
        console.log('\n=== 解析字段 ===');
        console.log('标题:', item.vod_name);
        console.log('年份:', item.vod_year);
        console.log('类型:', item.type_name);
        console.log('封面:', item.vod_pic);
        console.log('状态:', item.vod_status);
        console.log('评分:', item.vod_score);
        console.log('简介:', item.vod_content);
        console.log('播放链接:', item.vod_play_url);
      }
    }
    
    console.log('\n=== 测试完成 ===');
  } catch (error) {
    console.error('测试失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

testApi();