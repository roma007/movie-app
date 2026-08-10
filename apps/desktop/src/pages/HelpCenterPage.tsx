import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft, BookOpen, Play, Database, Settings, Heart, RotateCcw,
  ListVideo, Clock, Cpu, Gauge, HelpCircle, ChevronRight,
} from 'lucide-react';
import { useBackgroundStore } from '../themes/backgroundStore';

const faqGroups = [
  {
    title: '新手入门',
    icon: HelpCircle,
    items: [
      {
        q: '视频从哪来？',
        a: '本应用需要自己添加视频源。在网上找到视频源网站后，将其 API 地址添加到「设置 - 视频源管理」中，即可采集视频。采集教程里有详细的视频源配置方法。',
      },
      {
        q: '怎么看视频？',
        a: '添加视频源并完成采集后，首页会显示视频。点击海报即可播放，也可使用搜索功能查找。',
      },
      {
        q: '如何添加视频源？',
        a: '进入「设置 - 视频源管理」，点击「手动添加」输入编码、名称和 API 地址保存，或使用「AI 导入」批量添加。具体步骤见采集教程。',
      },
    ],
  },
  {
    title: '采集相关',
    icon: Database,
    items: [
      {
        q: '全量采集、增量采集、自动采集有什么区别？',
        a: '全量采集：拉取视频源的全部数据，耗时较长，适合首次使用。增量采集：只采集新增内容，速度快，适合日常追新。自动采集：按设定间隔定时执行增量采集，无需手动操作。详见采集教程。',
      },
      {
        q: '采集到的数据不全或重复怎么办？',
        a: '本 APP 使用指纹去重机制，相同名称和年份的视频会自动去重。如果数据不全，可能是视频源 API 限制了返回数量，可以尝试调整 pageSize 或采集页数参数。',
      },
      {
        q: '采集时提示"无法连接到视频源"怎么办？',
        a: '请检查视频源的 API 地址是否正确、网络是否能访问该地址，并用「检测」功能验证。部分站点可能需要特殊网络环境才能访问。',
      },
      {
        q: '自动采集为什么没有执行？',
        a: '请检查是否已在「采集配置」开启自动采集、是否存在启用中的视频源，以及是否与手动采集任务冲突。自动采集仅在无手动任务运行且达到设定间隔时触发。',
      },
    ],
  },
  {
    title: '播放相关',
    icon: Play,
    items: [
      {
        q: '播放不了怎么办？',
        a: '尝试切换其他播放线路，或等一会儿再重新播放。如果所有线路都不可用，可能是视频源失效了，建议重新采集或更换视频源。',
      },
      {
        q: '片尾下一集提示是什么？',
        a: '播放接近片尾时会提前提示下一集，可在「设置 - 使用偏好」中开启或关闭，并可调整提前提示的分钟数。',
      },
      {
        q: '播放缓冲卡顿怎么调？',
        a: '在「设置 - 使用偏好」中可调整「播放缓冲并发数」和「播放缓冲内存上限」。并发数越大卡顿越少，但越容易引起片源方反爬，请酌情调整。',
      },
    ],
  },
  {
    title: '常用功能',
    icon: Heart,
    items: [
      {
        q: '如何收藏视频？',
        a: '在视频详情页点击收藏按钮，之后可在「收藏」页面快速找到。',
      },
      {
        q: '观看历史在哪里？如何清除？',
        a: '首页和「历史」页面会显示观看记录，支持断点续播。移动端可在设置侧边栏点「清除观看历史」，桌面端在历史页面操作。',
      },
      {
        q: '首页显示哪些内容怎么调整？',
        a: '在「设置 - 使用偏好」的「首页偏好」中可多选「搜索优先」「追新电影」「追剧/综艺」，首页会根据你的偏好展示对应卡片。',
      },
      {
        q: '如何隐藏不想看的视频分类？',
        a: '在「设置 - 视频管理」的「隐藏管理」中，可对子类型进行隐藏/取消隐藏操作，隐藏后相关分类页面不再显示。',
      },
    ],
  },
];

export default function HelpCenterPage() {
  const clearBgImage = useBackgroundStore((s) => s.clearBgImage);
  useEffect(() => { clearBgImage(); }, [clearBgImage]);
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="sticky top-0 z-10 -mx-6 px-6 pb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/')} className="hover:text-text">
            <ArrowLeft className="size-4 mr-2" />
            返回
          </Button>
          <h1 className="text-2xl font-bold">帮助中心</h1>
        </div>
      </div>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <BookOpen className="size-8 text-muted-foreground shrink-0 mt-1" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold mb-2">采集教程</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              从配置视频源（手动配置 / AI 导入）到全量采集、手动增量采集、自动增量采集，
              手把手带你掌握本应用的采集功能。
            </p>
          </div>
          <Button onClick={() => navigate('/help/guide')} className="shrink-0">
            进入教程 <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </Card>

      {faqGroups.map((group) => (
        <Card key={group.title} className="p-2">
          <div className="flex items-center gap-2 px-3 pt-3 pb-2">
            <group.icon className="size-4 text-muted-foreground" />
            <h2 className="font-semibold">{group.title}</h2>
          </div>
          {group.items.map((faq, i) => (
            <details key={i} className="group">
              <summary className="flex cursor-pointer select-none list-none items-center justify-between px-3 py-3 hover:bg-secondary/50 rounded-lg transition-colors">
                <span className="font-medium text-sm pr-3">{faq.q}</span>
                <ChevronRight className="size-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              </summary>
              <div className="px-3 pb-3 -mt-1 text-sm text-muted-foreground leading-relaxed">
                {faq.a}
              </div>
            </details>
          ))}
        </Card>
      ))}

      <p className="text-xs text-muted-foreground text-center">
        更多问题请联系管理员
      </p>
    </div>
  );
}
