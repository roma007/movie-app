import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Play, Database, Settings, Heart, RotateCcw } from 'lucide-react';

const faqs = [
  {
    icon: Database,
    question: '视频从哪来？',
    answer: '本应用需要自己添加视频源。在网上找到视频源网站后，将其API地址添加到「设置 - 视频源管理」中，即可采集视频。',
  },
  {
    icon: Play,
    question: '怎么看视频？',
    answer: '添加视频源并完成采集后，首页会显示视频。点击海报即可播放，也可使用搜索功能查找。',
  },
  {
    icon: Settings,
    question: '如何添加视频源？',
    answer: '进入「设置 - 视频源管理」，点击「添加视频源」，输入视频源名称和API地址，保存后开始采集。',
  },
  {
    icon: Heart,
    question: '如何收藏视频？',
    answer: '在视频详情页点击收藏按钮，之后可在「收藏」页面快速找到。',
  },
  {
    icon: RotateCcw,
    question: '播放不了怎么办？',
    answer: '切换其他播放线路试试，或等一会儿再重新播放。如果所有线路都不可用，可能是视频源失效了。',
  },
];

export default function HelpCenterPage() {
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/')} className="hover:text-primary">
          <ArrowLeft className="size-4 mr-2" />
          返回
        </Button>
        <h1 className="text-2xl font-bold">帮助中心</h1>
      </div>

      <Card className="divide-y divide-border bg-card border-border">
        {faqs.map((faq, i) => (
          <div key={i} className="flex gap-4 p-5">
            <div className="shrink-0 mt-0.5">
              <faq.icon className="size-5 text-primary" />
            </div>
            <div>
              <div className="font-medium mb-1">{faq.question}</div>
              <div className="text-sm text-muted-foreground">{faq.answer}</div>
            </div>
          </div>
        ))}
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        更多问题请联系管理员
      </p>
    </div>
  );
}
