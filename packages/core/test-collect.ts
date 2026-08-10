import axios from 'axios';
import { CMSAdapter } from './src/services/cmsAdapter';
import { DataNormalizer } from './src/utils/normalizer';
import { mapType, refineTypeByEpisodes, isVersionTitle } from './src/utils/typeMapper';

const MIN_YEAR = 2025;

async function testCollection() {
  console.log('=== 开始测试采集流程 ===\n');

  const adapter = new CMSAdapter('https://www.mdzyapi.com/api.php/provide/vod', 2);
  
  try {
    console.log('1. 获取列表数据...');
    const listResponse = await adapter.getList(1, 3);
    console.log(`   获取到 ${listResponse.list.length} 条数据`);
    
    for (const listItem of listResponse.list) {
      console.log(`\n--- 测试项目: ${listItem.vod_name} (ID: ${listItem.vod_id}) ---`);
      
      console.log('2. 获取详情数据...');
      const detailResponse = await adapter.getDetail(String(listItem.vod_id));
      
      if (!detailResponse.list || detailResponse.list.length === 0) {
        console.log('   ❌ 获取详情失败');
        continue;
      }
      
      const item = detailResponse.list[0];
      console.log(`   ✅ 成功获取详情`);
      
      console.log('\n3. 检查关键字段:');
      console.log(`   vod_year: "${item.vod_year}"`);
      console.log(`   vod_name: "${item.vod_name}"`);
      console.log(`   vod_type: "${item.vod_type}"`);
      console.log(`   vod_remarks: "${item.vod_remarks}"`);
      console.log(`   vod_play_from: "${item.vod_play_from}"`);
      console.log(`   vod_play_url: "${item.vod_play_url ? '有数据' : '空'}"`);
      
      console.log('\n4. 测试年份解析...');
      const normalizer = new DataNormalizer(MIN_YEAR);
      const year = normalizer.normalizeYear(item.vod_year);
      console.log(`   解析结果: ${year}`);
      
      if (!year) {
        console.log('   ❌ 年份解析失败，数据被跳过');
        continue;
      }
      
      console.log('\n5. 测试标题标准化...');
      const title = await normalizer.normalizeTitle(item.vod_name);
      console.log(`   标准化标题: "${title}"`);
      
      if (!title) {
        console.log('   ❌ 标题标准化失败，数据被跳过');
        continue;
      }
      
      console.log('\n6. 测试类型映射...');
      const typeName = item.vod_type || '';
      const remarks = item.vod_remarks || '';
      const rawGenres = typeName.split(/[,，/]/).filter(Boolean);
      let mediaType = mapType(typeName, remarks, item.vod_play_from || '', rawGenres);
      console.log(`   映射类型: ${mediaType}`);
      
      console.log('\n7. 测试指纹生成...');
      const fingerprint = await normalizer.generateFingerprint(title, year, mediaType);
      console.log(`   指纹: ${fingerprint}`);
      
      console.log('\n✅ 项目通过所有检查，可以采集!');
    }
    
    console.log('\n=== 测试完成 ===');
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

testCollection();
