import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { projectRuntimeRoot } from './local-app-runtime/index'

export type ProjectAgentRuntimeContext = {
  projectId: string
  projectRoot: string
  runtimeRoot: string
}

export async function resolveProjectAgentRuntimeContext(
  projectId: string | undefined,
  projectRoot: string,
): Promise<ProjectAgentRuntimeContext | null> {
  const normalizedProjectId = projectId?.trim()
  if (!normalizedProjectId || !projectRoot.trim()) return null
  try {
    const canonicalProjectRoot = await realpath(projectRoot)
    return {
      projectId: normalizedProjectId,
      projectRoot: canonicalProjectRoot,
      runtimeRoot: projectRuntimeRoot(canonicalProjectRoot),
    }
  } catch {
    return null
  }
}

export function buildProjectRuntimeSystemPrompt(context: ProjectAgentRuntimeContext): string {
  const runtimeRoot = path.resolve(context.runtimeRoot)
  return `<agentos_project_runtime>
当前项目的 AgentOS Runtime 网页工程根目录是：
${runtimeRoot}

当任务需要创建或修改项目 Runtime 时，必须遵守以下要求：
1. 先读取并分析当前项目文件夹中已有的文档、数据、代码和其他内容，识别真实可用的信息与数据源；Runtime 必须基于这些现有内容构建，不能脱离项目上下文制作通用示例。
2. 必须构建一个数据可视化工作台，使用清晰的指标、图表、列表和必要的交互来呈现当前项目内容。
3. 必须使用 Next.js、React 和 TypeScript 实现。必须在 next.config 中配置 output: 'export' 静态导出，使 npm run build 在 out/ 目录下产出可直接打开的 index.html，并提供可执行的 dev 与 build 脚本。
4. 不得使用 Python、Flask、Streamlit 或其他 Python 方案作为 Runtime 的实现、服务或启动入口，也不要创建 Python 脚本来替代 Next.js 应用。
5. Runtime 的网页、组件、样式、脚本、资源、依赖和构建配置必须全部位于上述 .agentos 目录内。
6. 必须在上述 .agentos 目录内执行 npm install 安装工程依赖，然后执行 npm run build；只有构建成功并生成 out/index.html 才能结束任务。若安装或构建失败，必须修复后重试。系统按目录中的实际产物判断该 Runtime 能否提供已保存预览，因此 out/index.html 缺失即视为未完成。

不要把 Runtime 网页实现写入项目根目录或 Workspace Runtime 目录。
可以只读访问项目其他文件作为数据和上下文，但不要为了构建 Runtime 而改写这些源文件。
用户明确要求修改非 Runtime 项目代码时，按用户指定目标执行。
</agentos_project_runtime>`
}
