import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, BookOpen, Database, RefreshCw, Rocket, Settings, Sparkles, UserPlus, Wand2 } from 'lucide-react';
import { useBackgroundStore } from '../themes/backgroundStore';

const cmsRefs = [
  {
    name: '海洋CMS',
    version: 'HYCMS',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    tip: '最常用的视频 CMS，稳定性好，建议优先使用。',
  },
  {
    name: '苹果CMS8',
    version: 'MacCMS8',
    apiFormat: 'http://你的域名/index.php/api.php/provide/vod/at/xml/',
    tip: '经典版本，兼容性好，建议升级到 MacCMS10。',
  },
  {
    name: '苹果CMS10',
    version: 'MacCMS10',
    apiFormat: 'http://你的域名/index.php/api.php/provide/vod/at/xml/',
    tip: '目前最主流，功能完善，默认开启请求频率限制。',
  },
  {
    name: '飞飞CMS',
    version: 'FeiFeiCMS',
    apiFormat: 'http://你的域名/api.php/',
    tip: '资源丰富但稳定性参差，部分站点需要认证密钥。',
  },
  {
    name: '赞片CMS',
    version: 'ZanPianCMS',
    apiFormat: 'http://你的域名/index.php/api.php/provide/vod/at/xml/',
    tip: '基于苹果 CMS 二次开发，API 兼容苹果 CMS。',
  },
  {
    name: '爱影CMS',
    version: 'AiYingCMS',
    apiFormat: 'http://你的域名/api.php/provide/vod/at/xml/',
    tip: '轻量级，资源更新快，对请求频率较敏感。',
  },
];

const SECTION_LINKS = [
  { id: 'source-config', label: '视频源配置' },
  { id: 'full-collect', label: '全量采集' },
  { id: 'incremental-collect', label: '手动增量采集' },
  { id: 'auto-collect', label: '自动增量采集' },
];

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-muted-foreground text-white text-xs shrink-0 mt-0.5">{index}</span>
      <span>{children}</span>
    </li>
  );
}

function SectionTitle({ id, icon, title }: { id: string; icon: React.ReactNode; title: string }) {
  return (
    <div id={id} className="flex items-center gap-2 mb-4 scroll-mt-28">
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

export default function CollectGuidePage() {
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/help')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">采集教程</h1>
        </div>
      </div>

      <Card className="p-6 mb-6">
        <div className="flex items-start gap-4">
          <BookOpen className="size-8 text-muted-foreground shrink-0 mt-1" />
          <div>
            <h2 className="text-lg font-semibold mb-2">采集教程</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              从配置视频源到全量、增量、自动采集，本教程带你完整掌握本应用的采集功能。
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {SECTION_LINKS.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  className="px-3 py-1.5 text-sm rounded-lg bg-muted-foreground/10 text-text-secondary hover:bg-muted-foreground/20 hover:text-text transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6 mb-6">
        <SectionTitle id="source-config" icon={<Database className="size-5 text-muted-foreground" />} title="一、视频源配置" />
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          采集前必须先添加视频源。支持手动配置和 AI 导入两种方式。
        </p>

        <div className="mb-4">
          <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
            <UserPlus className="size-4 text-muted-foreground" /> 1. 手动配置
          </h3>
          <ol className="text-sm text-muted-foreground space-y-2">
            <Step index={1}>打开「设置」页面，点击「视频源管理」</Step>
            <Step index={2}>点击「手动添加」，填写视频源信息：编码（唯一标识）、名称、API 地址、速率限制（1-10）</Step>
            <Step index={3}>点击「保存」，视频源出现在列表中</Step>
            <Step index={4}>点击「检测」确认源可用，用开关启用/禁用源</Step>
          </ol>
        </div>

        <div className="mb-4">
          <h3 className="text-md font-semibold mb-2">常见 CMS 接口格式参考</h3>
          <div className="space-y-2">
            {cmsRefs.map((cms) => (
              <div key={cms.name} className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 p-3 rounded-lg bg-muted/40">
                <span className="text-sm font-medium shrink-0">
                  {cms.name} <span className="text-xs text-text-secondary">{cms.version}</span>
                </span>
                <code className="text-xs text-muted-foreground font-mono break-all flex-1">{cms.apiFormat}</code>
                <span className="text-xs text-text-secondary">{cms.tip}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-md font-semibold mb-2 flex items-center gap-2">
            <Wand2 className="size-4 text-muted-foreground" /> 2. AI 导入
          </h3>
          <ol className="text-sm text-muted-foreground space-y-2">
            <Step index={1}>进入「视频源管理」，点击「AI 导入」</Step>
            <Step index={2}>复制弹窗中的提示词，发给 AI 助手（如 ChatGPT、Claude 等）</Step>
            <Step index={3}>将 AI 返回的数据粘贴到输入框中，点击「解析并预览」</Step>
            <Step index={4}>确认预览结果（重复源自动跳过），点击「导入」即可批量添加</Step>
          </ol>
        </div>
      </Card>

      <Card className="p-6 mb-6">
        <SectionTitle id="full-collect" icon={<Rocket className="size-5 text-muted-foreground" />} title="二、全量采集" />
        <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p><span className="text-text font-medium">适用场景：</span>首次添加视频源，或需要建立完整的本地片库。</p>
          <p><span className="text-text font-medium">操作方式：</span>进入「视频源管理」，点击对应源的「全量采集」按钮。</p>
          <p><span className="text-text font-medium">参数调整：</span>在「采集配置」中可设置「全量采集最大页数」，限制单次采集的数据量。</p>
          <p><span className="text-text font-medium">特点：</span>采集该源的全部数据，耗时较长，建议在初次使用时执行一次。</p>
        </div>
      </Card>

      <Card className="p-6 mb-6">
        <SectionTitle id="incremental-collect" icon={<RefreshCw className="size-5 text-muted-foreground" />} title="三、手动增量采集" />
        <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p><span className="text-text font-medium">适用场景：</span>日常追新，只采集新增的视频内容。</p>
          <p><span className="text-text font-medium">操作方式：</span>进入「视频源管理」点击「增量采集」，或在首页「追新电影」卡片点击「一键采集」。</p>
          <p><span className="text-text font-medium">参数调整：</span>在「采集配置」中可设置「增量采集最大页数」与「断点小时数」，控制增量采集的范围。</p>
          <p><span className="text-text font-medium">特点：</span>速度快、资源消耗小，建议定期手动执行以保持数据最新。</p>
        </div>
      </Card>

      <Card className="p-6 mb-6">
        <SectionTitle id="auto-collect" icon={<Settings className="size-5 text-muted-foreground" />} title="四、自动增量采集" />
        <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
          <p><span className="text-text font-medium">开启方式：</span>进入「设置 → 采集配置」，开启「自动增量采集」。</p>
          <p><span className="text-text font-medium">相关选项：</span>启用自动采集、定时采集间隔（小时）、启动时立即采集。</p>
          <p><span className="text-text font-medium">触发条件：</span>有启用中的视频源且无手动采集任务运行时才执行；移动端回前台也会自动补检一次。</p>
          <p><span className="text-text font-medium">注意：</span>自动采集与手动采集互斥，手动采集进行中时自动采集会跳过。</p>
        </div>
      </Card>

      <Card className="p-6 mt-4">
        <h3 className="text-lg font-semibold mb-3">常见问题</h3>
        <div className="space-y-4">
          <div className="pb-3">
            <div className="font-medium text-sm">Q: 采集时提示"无法连接到视频源"怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 请检查视频源的API地址是否正确，网络是否可以访问该地址。部分站点可能需要科学上网才能访问。
            </div>
          </div>
          <div className="pb-3">
            <div className="font-medium text-sm">Q: 采集到的数据不全或重复怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 本APP使用指纹去重机制，相同名称和年份的视频会自动去重。如果数据不全，可能是视频源API限制了返回数量，可以尝试调整pageSize参数。
            </div>
          </div>
          <div className="pb-3">
            <div className="font-medium text-sm">Q: 播放视频时无法加载怎么办？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 请检查网络连接，尝试切换不同的播放源。部分视频源可能存在防盗链机制，需要在采集配置中设置referer头。
            </div>
          </div>
          <div className="pb-3">
            <div className="font-medium text-sm">Q: 如何更新视频源的新内容？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 在视频源管理点击「增量采集」，或开启「自动增量采集」让系统定期自动更新。建议保持数据最新。
            </div>
          </div>
          <div>
            <div className="font-medium text-sm">Q: 自动采集为什么没有执行？</div>
            <div className="text-sm text-muted-foreground mt-1">
              A: 请检查是否已在「采集配置」开启自动采集，是否存在启用中的视频源，以及是否与手动采集任务冲突。自动采集仅在无手动任务运行且达到设定间隔时触发。
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
