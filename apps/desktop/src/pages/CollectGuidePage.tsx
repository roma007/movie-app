import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';

const cmsGuides = [
  {
    name: '海洋CMS',
    version: 'HYCMS',
    description: '基于ThinkPHP开发的视频管理系统，支持多模板、多采集源',
    features: ['支持自定义采集规则', '内置播放器', '多语言支持', 'SEO优化'],
    config: [
      '接口地址格式：http://你的域名/api.php/provide/vod/',
      '接口参数：ac=list（列表）、ac=detail（详情）、ac=play（播放）、ac=types（分类）',
      '推荐配置：pageSize=20，rateLimit=2',
      '注意：部分站点需要设置referer头',
    ],
    tips: '海洋CMS是最常用的视频CMS之一，稳定性较好，建议优先使用。',
  },
  {
    name: '苹果CMS8',
    version: 'MacCMS8',
    description: '经典的影视内容管理系统，广泛应用于视频网站搭建',
    features: ['自动采集', '云转码', '多线路支持', '广告管理'],
    config: [
      '接口地址格式：http://你的域名/index.php/api.php/provide/vod/',
      '接口参数：ac=list、ac=detail、ac=play、ac=types',
      '推荐配置：pageSize=20，rateLimit=2',
      '注意：部分新版苹果CMS8需要在后台开启API访问',
    ],
    tips: '苹果CMS8版本较旧，建议升级到苹果CMS10以获得更好的兼容性。',
  },
  {
    name: '苹果CMS10',
    version: 'MacCMS10',
    description: '苹果CMS的最新版本，支持更多功能和更好的性能',
    features: ['JSON API', '阿里云OSS支持', '微信小程序', 'APP端支持'],
    config: [
      '接口地址格式：http://你的域名/index.php/api.php/provide/vod/',
      '接口参数：ac=list、ac=detail、ac=play、ac=types',
      '推荐配置：pageSize=30，rateLimit=3',
      '注意：苹果CMS10默认开启了请求频率限制',
    ],
    tips: '苹果CMS10是目前最主流的选择，功能完善，更新频繁。',
  },
  {
    name: '飞飞CMS',
    version: 'FeiFeiCMS',
    description: '专注于影视资源整合的CMS系统',
    features: ['自动采集', '资源站对接', '播放解析', '数据统计'],
    config: [
      '接口地址格式：http://你的域名/api.php/',
      '接口参数：ac=list、ac=detail、ac=play、ac=types',
      '推荐配置：pageSize=20，rateLimit=2',
      '注意：部分飞飞CMS站点需要认证密钥',
    ],
    tips: '飞飞CMS资源丰富，但稳定性参差不齐，建议选择口碑好的站点。',
  },
  {
    name: '赞片CMS',
    version: 'ZanPianCMS',
    description: '基于苹果CMS二次开发的影视管理系统',
    features: ['自动采集', '智能搜索', '多线路切换', '弹幕支持'],
    config: [
      '接口地址格式：http://你的域名/index.php/api.php/provide/vod/',
      '接口参数：ac=list、ac=detail、ac=play、ac=types',
      '推荐配置：pageSize=20，rateLimit=2',
      '注意：赞片CMS与苹果CMSAPI兼容',
    ],
    tips: '赞片CMS在苹果CMS基础上增加了一些特色功能，适合追求差异化的用户。',
  },
  {
    name: '爱影CMS',
    version: 'AiYingCMS',
    description: '轻量级影视内容管理系统',
    features: ['一键采集', '模板美化', '广告联盟', '移动端适配'],
    config: [
      '接口地址格式：http://你的域名/api.php/provide/vod/',
      '接口参数：ac=list、ac=detail、ac=play、ac=types',
      '推荐配置：pageSize=20，rateLimit=1',
      '注意：爱影CMS对请求频率较为敏感',
    ],
    tips: '爱影CMS资源更新快，但稳定性一般，建议配合重试机制使用。',
  },
];

export default function CollectGuidePage() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={() => navigate('/settings')} className="hover:text-primary">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <h1 className="text-2xl font-bold">采集教程</h1>
      </div>

      <Card className="p-6 mb-6 bg-card border-border">
        <div className="flex items-start gap-4">
          <BookOpen className="size-8 text-primary shrink-0 mt-1" />
          <div>
            <h2 className="text-lg font-semibold mb-2">视频源配置指南</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              本APP支持多种CMS视频源的采集，包括海洋CMS、苹果CMS8、苹果CMS10、飞飞CMS、赞片CMS、爱影CMS等。
              以下是各类CMS的配置方法和注意事项。
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {cmsGuides.map((cms) => (
          <Card key={cms.name} className="p-5 bg-card border-border hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{cms.name}</h3>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-primary/10 text-primary">
                    {cms.version}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{cms.description}</p>
              </div>
              <a
                href={`https://www.baidu.com/s?wd=${encodeURIComponent(cms.name + ' CMS')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium text-primary">主要功能</div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {cms.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-1">
                      <span className="w-1 h-1 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-primary">配置方法</div>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {cms.config.map((item) => (
                    <li key={item} className="flex items-start gap-1">
                      <span className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-primary">使用提示</div>
                <p className="text-sm text-muted-foreground">{cms.tips}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 mt-6 bg-card border-border">
        <h3 className="text-lg font-semibold mb-3">通用配置步骤</h3>
        <ol className="text-sm text-muted-foreground space-y-2">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary text-white text-xs shrink-0">1</span>
            在设置页面点击"视频源管理"，进入视频源列表
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary text-white text-xs shrink-0">2</span>
            点击"添加视频源"，输入视频源名称和API地址
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary text-white text-xs shrink-0">3</span>
            根据视频源类型选择对应的CMS类型
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary text-white text-xs shrink-0">4</span>
            设置优先级（数字越小优先级越高），点击保存
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary text-white text-xs shrink-0">5</span>
            在采集任务页面创建采集任务，选择刚添加的视频源进行采集
          </li>
        </ol>
      </Card>

      <Card className="p-6 mt-4 bg-card border-border">
        <h3 className="text-lg font-semibold mb-3">常见问题</h3>
        <div className="space-y-4">
          <div className="border-b border-border pb-3">
            <div className="font-medium text-sm">Q: 采集时提示"无法连接到视频源"怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 请检查视频源的API地址是否正确，网络是否可以访问该地址。部分站点可能需要科学上网才能访问。
            </div>
          </div>
          <div className="border-b border-border pb-3">
            <div className="font-medium text-sm">Q: 采集到的数据不全或重复怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 本APP使用指纹去重机制，相同名称和年份的视频会自动去重。如果数据不全，可能是视频源API限制了返回数量，可以尝试调整pageSize参数。
            </div>
          </div>
          <div className="border-b border-border pb-3">
            <div className="font-medium text-sm">Q: 播放视频时无法加载怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 请检查网络连接，尝试切换不同的播放源。部分视频源可能存在防盗链机制，需要在采集配置中设置referer头。
            </div>
          </div>
          <div>
            <div className="font-medium text-sm">Q: 如何更新视频源的新内容？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 在采集任务页面创建"增量采集"任务，系统会自动采集新增的视频内容。建议定期执行增量采集以保持数据最新。
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}