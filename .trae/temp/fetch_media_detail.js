const axios = require('axios');

const sources = [
  { name: '魔都资源', baseUrl: 'https://www.mdzyapi.com/api.php/provide/vod' },
  { name: '百度云资源', baseUrl: 'https://api.apibdzy.com/api.php/provide/vod' },
  { name: '量子资源', baseUrl: 'http://cj.lziapi.com/api.php/provide/vod' },
  { name: '无尽资源', baseUrl: 'https://api.wujinapi.com/api.php/provide/vod' },
  { name: '红牛资源', baseUrl: 'https://www.hongniuzy3.com/api.php/provide/vod' },
  { name: '电影天堂', baseUrl: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
];

async function searchAndGetDetail(keyword) {
  for (const source of sources) {
    try {
      console.log(`\n=== ${source.name} ===`);
      
      const searchUrl = `${source.baseUrl}?ac=videolist&wd=${encodeURIComponent(keyword)}&pg=1`;
      console.log(`搜索URL: ${searchUrl}`);
      
      const searchRes = await axios.get(searchUrl, { timeout: 10000 });
      const searchData = searchRes.data;
      
      if (!searchData.list || searchData.list.length === 0) {
        console.log('搜索结果: 无');
        continue;
      }
      
      console.log(`搜索结果: ${searchData.list.length} 条`);
      const firstItem = searchData.list[0];
      console.log(`匹配项: ${firstItem.vod_name} (vod_id: ${firstItem.vod_id})`);
      
      const detailUrl = `${source.baseUrl}?ac=detail&ids=${firstItem.vod_id}`;
      console.log(`详情URL: ${detailUrl}`);
      
      const detailRes = await axios.get(detailUrl, { timeout: 10000 });
      const detailData = detailRes.data;
      
      if (!detailData.list || detailData.list.length === 0) {
        console.log('详情: 无');
        continue;
      }
      
      const item = detailData.list[0];
      console.log('\n--- 原始数据 ---');
      console.log(JSON.stringify(item, null, 2));
      
    } catch (error) {
      console.log(`错误: ${error.message}`);
    }
  }
}

searchAndGetDetail('诺曼底72小时').catch(console.error);