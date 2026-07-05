export type VoiceAutoRoute = 'command' | 'agent_task' | 'answer'

const INTERNAL_COMMAND_PATTERNS = [
  /^(新建|创建|再开|开一个).*(对话|聊天)$/i,
  /^(new|create|start).*(thread|chat)$/i,
  /^(打开|回到|返回|进入).*(首页|项目首页|主页面|工作台|文档页|文档|帮助文档)$/i,
  /^(open|go|back).*(home|workspace|docs|documentation)$/i,
  /^(打开|进入|配置|检查).*(模型设置|搜索设置|websearch|mcp|技能设置|skills|agent mode|agent 设置|智能体设置|更新设置|版本更新|开发者设置|调试设置)$/i,
  /^(open|configure|check).*(settings|model settings|search settings|websearch|mcp|skills|agent settings|updates|developer|debug)$/i,
  /^(打开|搜索|查找).*(全局搜索|搜索窗口|搜索当前项目|项目文件|文件搜索|对话搜索|聊天搜索|消息搜索|聊天记录|记忆搜索|知识|技能搜索|任务搜索)$/i,
  /^(open|search|find).*(search|files|chats|threads|messages|history|memory|knowledge|skills|tasks)$/i,
  /^(收起|隐藏|折叠|展开|显示|打开).*(侧栏|文件面板|文件树|辅助面板)$/i,
  /^(collapse|hide|expand|show|open|close).*(sidebar|file panel|file tree|side panel)$/i,
  /^(打开|显示|刷新).*(agent 状态|agent状态|状态面板)$/i,
  /^(open|show|refresh).*(agent status|status panel)$/i,
  /^(输入|把输入框设为|在输入框输入|发送|提交消息)/i,
  /^(type|write|send|submit message)/i,
  /^(归档|关闭|置顶|取消置顶).*((当前|这个).*)?(对话|聊天|项目)/i,
  /^(archive|pin|unpin).*(current|this|thread|chat|project)/i,
  /^close.*(thread|chat|project)/i,
  /^(刷新).*(任务卡|项目首页任务卡|卡片|首页卡片)$/i,
  /^(refresh).*(task cards|project home cards|cards)$/i,
  /^(运行|执行|启动).*(技能)$/i,
  /^(run|start).*(skill)$/i,
  /^(切换到|切换模型到|使用).*(模型|mini|max|claude|gpt|glm|m3|sonnet|opus|haiku)/i,
  /^(switch|use).*(model|mini|max|claude|gpt|glm|m3|sonnet|opus|haiku)/i,
  /^(关掉|关闭|禁用|打开|启用).*项目.*(mcp|server|服务)/i,
  /^(disable|turn off|enable|turn on).*(mcp|server).*(project)/i,
  /^(打开|访问).*(google|谷歌).*页面?$/i,
  /^(open|go to).*(google).*page?$/i,
  /(模型厂商|模型设置摘要|当前模型设置摘要|现在用的是哪个模型|当前请求模型|配置了哪些模型|列出模型厂商)/i,
  /(当前页面有什么|这里有什么|描述当前页面|总结当前页面|读取当前页面)/i,
  /(控件接入情况|控件实现情况|还有多少控件|多少控件.*omni|omni.*coverage|control coverage)/i,
]

const AGENT_TASK_PATTERNS = [
  /^(帮我)?(打开|进入|启动).*(macos|系统设置|wi-?fi|无线|蓝牙|声音|显示器|safari|微信|访达|finder|终端|terminal|活动监视器|备忘录|日历|邮件|下载文件夹|桌面文件夹|当前项目.*todo)/i,
  /^(open|launch|show).*(system settings|wi-?fi|bluetooth|sound|display|safari|finder|terminal|activity monitor|notes|calendar|mail|downloads|desktop|todo)/i,
  /^(用\s*safari|用Safari).*(打开|搜索|百度|网页|页面)/i,
  /^(use safari).*(open|search|web|page)/i,
  /^(百度搜索|百度查|百度一下|用百度搜索).+/i,
  /^(百度搜索|搜索|打开).*(百度|网页|页面|http|https)/i,
  /^(截屏|截图|截图并复制|把音量|调大|调小|静音|开启勿扰|关闭勿扰|打开最近的截图|关闭当前窗口|最小化当前窗口|切换到上一个应用)/i,
  /^(screenshot|capture|volume|mute|do not disturb|focus mode|close current window|minimize current window|switch to previous app)/i,
]

const ANSWER_PATTERNS = [
  /(总结当前对话|解释当前报错|当前业务逻辑|业务逻辑是什么|帮我解释|帮我分析|帮我看看|报错|错误|异常)/i,
  /(是什么|为什么|怎么|如何|能不能|是否|原因|区别|说明一下|解释一下|总结一下|分析一下|下一步|建议)/i,
  /(summarize|explain|why|what is|what's|how to|how do|can you|could you|analyze|error|exception|next step)/i,
]

export function classifyVoiceAutoRoute(utterance: string): VoiceAutoRoute {
  const normalized = normalizeVoiceText(utterance)
  if (!normalized) return 'command'
  if (matchesAny(normalized, INTERNAL_COMMAND_PATTERNS)) return 'command'
  if (matchesAny(normalized, AGENT_TASK_PATTERNS)) return 'agent_task'
  if (matchesAny(normalized, ANSWER_PATTERNS)) return 'answer'
  return 'command'
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function normalizeVoiceText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
