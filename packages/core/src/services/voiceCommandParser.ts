/**
 * 语音命令解析器
 * 将语音识别的文本转换为具体的命令
 */

import type {
  VoiceCommand,
  VoiceCommandCategory,
  ParsedVoiceCommand,
  CommandParameter,
} from '../types/voice';

/** 命令注册表 */
interface CommandRegistry {
  commands: Map<string, VoiceCommand>;
  aliases: Map<string, string>; // alias -> commandId
}

/**
 * 语音命令解析器类
 */
export class VoiceCommandParser {
  private registry: CommandRegistry = {
    commands: new Map(),
    aliases: new Map(),
  };

  /**
   * 注册语音命令
   */
  registerCommand(command: VoiceCommand): void {
    this.registry.commands.set(command.id, command);
    
    // 注册所有别名
    for (const alias of command.aliases) {
      this.registry.aliases.set(alias.toLowerCase(), command.id);
    }
  }

  /**
   * 批量注册命令
   */
  registerCommands(commands: VoiceCommand[]): void {
    for (const command of commands) {
      this.registerCommand(command);
    }
  }

  /**
   * 获取所有已注册的命令
   */
  getRegisteredCommands(): VoiceCommand[] {
    return Array.from(this.registry.commands.values());
  }

  /**
   * 按类别获取命令
   */
  getCommandsByCategory(category: VoiceCommandCategory): VoiceCommand[] {
    return this.getRegisteredCommands().filter(
      (cmd) => cmd.category === category
    );
  }

  /**
   * 解析语音文本为命令
   */
  parse(text: string): ParsedVoiceCommand | null {
    if (!text || text.trim().length === 0) {
      return null;
    }

    const normalizedText = text.toLowerCase().trim();

    // 1. 尝试精确匹配别名
    const exactMatch = this.findExactMatch(normalizedText);
    if (exactMatch) {
      return {
        command: exactMatch.command,
        params: exactMatch.params,
        confidence: 1.0,
        rawText: text,
      };
    }

    // 2. 尝试模糊匹配
    const fuzzyMatch = this.findFuzzyMatch(normalizedText);
    if (fuzzyMatch && fuzzyMatch.confidence > 0.6) {
      return {
        command: fuzzyMatch.command,
        params: fuzzyMatch.params,
        confidence: fuzzyMatch.confidence,
        rawText: text,
      };
    }

    return null;
  }

  /**
   * 精确匹配
   */
  private findExactMatch(text: string): { command: VoiceCommand; params: Record<string, any> } | null {
    // 检查别名
    const commandId = this.registry.aliases.get(text);
    if (commandId) {
      const command = this.registry.commands.get(commandId);
      if (command) {
        return {
          command,
          params: this.extractParams(text, command),
        };
      }
    }

    return null;
  }

  /**
   * 模糊匹配
   */
  private findFuzzyMatch(text: string): { command: VoiceCommand; params: Record<string, any>; confidence: number } | null {
    let bestMatch: { command: VoiceCommand; params: Record<string, any>; confidence: number } | null = null;

    for (const [alias, commandId] of this.registry.aliases.entries()) {
      const command = this.registry.commands.get(commandId);
      if (!command) continue;

      // 检查文本是否包含别名
      if (text.includes(alias)) {
        const confidence = alias.length / text.length;
        const params = this.extractParams(text, command);

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { command, params, confidence };
        }
      }
    }

    return bestMatch;
  }

  /**
   * 从文本中提取参数
   */
  private extractParams(text: string, command: VoiceCommand): Record<string, any> {
    const params: Record<string, any> = {};

    if (!command.parameters) {
      return params;
    }

    for (const param of command.parameters) {
      const value = this.extractParamValue(text, param);
      if (value !== undefined) {
        params[param.name] = value;
      } else if (param.defaultValue !== undefined) {
        params[param.name] = param.defaultValue;
      }
    }

    return params;
  }

  /**
   * 提取单个参数值
   */
  private extractParamValue(text: string, param: CommandParameter): any {
    // 数字参数：匹配 "X秒"、"X分钟" 等模式
    if (param.type === 'number') {
      const numberPatterns = [
        /(\d+)\s*秒/,
        /(\d+)\s*分钟/,
        /(\d+)\s*分钟/,
        /第\s*(\d+)\s*页/,
        /到\s*第?\s*(\d+)\s*分钟/,
        /快进\s*(\d+)/,
        /快退\s*(\d+)/,
      ];

      for (const pattern of numberPatterns) {
        const match = text.match(pattern);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    // 字符串参数：提取关键词
    if (param.type === 'string') {
      // 移除命令关键词，提取剩余部分
      const commandPatterns = ['搜索', '找', '查找', '搜索电影', '搜索电视剧'];
      let remaining = text;

      for (const pattern of commandPatterns) {
        remaining = remaining.replace(pattern, '').trim();
      }

      if (remaining.length > 0) {
        return remaining;
      }
    }

    // 布尔参数
    if (param.type === 'boolean') {
      const positiveWords = ['开启', '打开', '启用', '是', '对', '好'];
      const negativeWords = ['关闭', '禁用', '停止', '否', '不'];

      for (const word of positiveWords) {
        if (text.includes(word)) return true;
      }

      for (const word of negativeWords) {
        if (text.includes(word)) return false;
      }
    }

    return undefined;
  }

  /**
   * 验证命令是否有效
   */
  validateCommand(text: string): boolean {
    return this.parse(text) !== null;
  }

  /**
   * 获取命令建议
   */
  getCommandSuggestions(partialText: string): string[] {
    const normalizedText = partialText.toLowerCase();
    const suggestions: string[] = [];

    for (const alias of this.registry.aliases.keys()) {
      if (alias.startsWith(normalizedText)) {
        suggestions.push(alias);
      }
    }

    return suggestions;
  }
}

/**
 * 创建默认的语音命令解析器
 */
export function createDefaultParser(): VoiceCommandParser {
  const parser = new VoiceCommandParser();

  // 注册播放控制命令
  parser.registerCommands([
    {
      id: 'pause',
      name: '暂停',
      description: '暂停播放',
      aliases: ['暂停', '停一下', '停止播放', '停'],
      category: 'playback',
      execute: async () => {
        // 将在集成时实现
        console.log('执行暂停命令');
      },
    },
    {
      id: 'play',
      name: '播放',
      description: '继续播放',
      aliases: ['播放', '继续', '开始播放', '继续播放'],
      category: 'playback',
      execute: async () => {
        console.log('执行播放命令');
      },
    },
    {
      id: 'fast_forward',
      name: '快进',
      description: '快进指定时间',
      aliases: ['快进', '前进', '往前'],
      category: 'playback',
      parameters: [
        {
          name: 'seconds',
          type: 'number',
          required: false,
          defaultValue: 30,
          description: '快进秒数',
        },
      ],
      execute: async (params) => {
        console.log(`执行快进命令: ${params?.seconds || 30}秒`);
      },
    },
    {
      id: 'rewind',
      name: '快退',
      description: '快退指定时间',
      aliases: ['快退', '后退', '往回'],
      category: 'playback',
      parameters: [
        {
          name: 'seconds',
          type: 'number',
          required: false,
          defaultValue: 30,
          description: '快退秒数',
        },
      ],
      execute: async (params) => {
        console.log(`执行快退命令: ${params?.seconds || 30}秒`);
      },
    },
    {
      id: 'volume_up',
      name: '音量增加',
      description: '增加音量',
      aliases: ['音量增加', '大声点', '提高音量', '大声'],
      category: 'playback',
      execute: async () => {
        console.log('执行音量增加命令');
      },
    },
    {
      id: 'volume_down',
      name: '音量减少',
      description: '减少音量',
      aliases: ['音量减少', '小声点', '降低音量', '小声'],
      category: 'playback',
      execute: async () => {
        console.log('执行音量减少命令');
      },
    },
    {
      id: 'mute',
      name: '静音',
      description: '静音',
      aliases: ['静音', '关闭声音', '取消静音'],
      category: 'playback',
      execute: async () => {
        console.log('执行静音命令');
      },
    },
    {
      id: 'fullscreen',
      name: '全屏',
      description: '切换全屏',
      aliases: ['全屏', '全屏幕', '切换全屏'],
      category: 'playback',
      execute: async () => {
        console.log('执行全屏命令');
      },
    },
    {
      id: 'next_episode',
      name: '下一集',
      description: '播放下一集',
      aliases: ['下一集', '下一个', '下一集播放'],
      category: 'playback',
      execute: async () => {
        console.log('执行下一集命令');
      },
    },
    {
      id: 'previous_episode',
      name: '上一集',
      description: '播放上一集',
      aliases: ['上一集', '上一个', '上一集播放'],
      category: 'playback',
      execute: async () => {
        console.log('执行上一集命令');
      },
    },
  ]);

  // 注册搜索命令
  parser.registerCommands([
    {
      id: 'search',
      name: '搜索',
      description: '搜索内容',
      aliases: ['搜索', '找', '查找'],
      category: 'search',
      parameters: [
        {
          name: 'keyword',
          type: 'string',
          required: true,
          description: '搜索关键词',
        },
      ],
      execute: async (params) => {
        console.log(`执行搜索命令: ${params?.keyword}`);
      },
    },
    {
      id: 'search_movie',
      name: '搜索电影',
      description: '搜索电影',
      aliases: ['搜索电影', '找电影', '查找电影'],
      category: 'search',
      parameters: [
        {
          name: 'keyword',
          type: 'string',
          required: true,
          description: '电影名称',
        },
      ],
      execute: async (params) => {
        console.log(`执行搜索电影命令: ${params?.keyword}`);
      },
    },
    {
      id: 'search_tv',
      name: '搜索电视剧',
      description: '搜索电视剧',
      aliases: ['搜索电视剧', '找电视剧', '查找电视剧', '搜索剧'],
      category: 'search',
      parameters: [
        {
          name: 'keyword',
          type: 'string',
          required: true,
          description: '电视剧名称',
        },
      ],
      execute: async (params) => {
        console.log(`执行搜索电视剧命令: ${params?.keyword}`);
      },
    },
  ]);

  // 注册列表操作命令
  parser.registerCommands([
    {
      id: 'next_page',
      name: '下一页',
      description: '翻到下一页',
      aliases: ['下一页', '往后翻', '翻页'],
      category: 'list',
      execute: async () => {
        console.log('执行下一页命令');
      },
    },
    {
      id: 'previous_page',
      name: '上一页',
      description: '翻到上一页',
      aliases: ['上一页', '往前翻', '上翻'],
      category: 'list',
      execute: async () => {
        console.log('执行上一页命令');
      },
    },
    {
      id: 'go_to_page',
      name: '跳转到指定页',
      description: '跳转到指定页码',
      aliases: ['第几页', '跳转到'],
      category: 'list',
      parameters: [
        {
          name: 'page',
          type: 'number',
          required: true,
          description: '页码',
        },
      ],
      execute: async (params) => {
        console.log(`执行跳转到指定页命令: 第${params?.page}页`);
      },
    },
  ]);

  // 注册采集命令
  parser.registerCommands([
    {
      id: 'start_collect',
      name: '开始采集',
      description: '触发采集',
      aliases: ['开始采集', '采集', '更新', '刷新'],
      category: 'collection',
      execute: async () => {
        console.log('执行开始采集命令');
      },
    },
    {
      id: 'stop_collect',
      name: '停止采集',
      description: '停止采集',
      aliases: ['停止采集', '停止'],
      category: 'collection',
      execute: async () => {
        console.log('执行停止采集命令');
      },
    },
    {
      id: 'collect_status',
      name: '查看采集状态',
      description: '查看采集进度',
      aliases: ['采集状态', '查看采集', '采集进度'],
      category: 'collection',
      execute: async () => {
        console.log('执行查看采集状态命令');
      },
    },
  ]);

  // 注册设置命令
  parser.registerCommands([
    {
      id: 'open_settings',
      name: '打开设置',
      description: '进入设置页面',
      aliases: ['打开设置', '设置', '设置页面', '进入设置'],
      category: 'settings',
      execute: async () => {
        console.log('执行打开设置命令');
      },
    },
    {
      id: 'voice_settings',
      name: '语音控制设置',
      description: '语音控制设置',
      aliases: ['语音设置', '语音控制设置', '语音控制'],
      category: 'settings',
      execute: async () => {
        console.log('执行语音控制设置命令');
      },
    },
    {
      id: 'playback_settings',
      name: '播放设置',
      description: '播放设置',
      aliases: ['播放设置', '播放器设置'],
      category: 'settings',
      execute: async () => {
        console.log('执行播放设置命令');
      },
    },
  ]);

  // 注册导航命令
  parser.registerCommands([
    {
      id: 'go_home',
      name: '返回首页',
      description: '返回首页',
      aliases: ['返回首页', '首页', '回到首页'],
      category: 'navigation',
      execute: async () => {
        console.log('执行返回首页命令');
      },
    },
    {
      id: 'go_back',
      name: '返回',
      description: '返回上一页',
      aliases: ['返回', '后退', '退出'],
      category: 'navigation',
      execute: async () => {
        console.log('执行返回命令');
      },
    },
  ]);

  return parser;
}
