import z from '@deepseek-ai/schemastery'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { MEMORY_TYPE_LIST } from './vault.js'
import { resolvePaths } from './status.js'

const integer = (minimum = 0) => z.number().step(1).min(minimum).max(Number.MAX_SAFE_INTEGER)
const oneOf = (values) => z.union(values.map((value) => z.const(value)))

export const SettingsSchema = z.object({
  vaultPath: z.string().min(1).default('C:/Users/CHANGE_ME/Documents/Obsidian').description('Obsidian 库根目录（绝对路径）'),
  memoryRoot: z.string().min(1).default('Memory').description('库内的记忆子目录'),
  sandboxMode: oneOf(['workspace-write', 'danger-full-access']).default('workspace-write').description('写入权限'),
  project: z.string().default('deepseek-harness').description('项目标识'),
  injectBudgetChars: integer().default(2400).description('卡片字符上限；0 禁用卡片'),
  alwaysInjectTypes: z.array(oneOf(MEMORY_TYPE_LIST)).default(['preference', 'open-question']).description('优先注入类型'),
  cardRecentCount: integer().default(8).description('最近条目数'),
  refreshTtlMs: integer().default(5000).description('索引缓存有效期（毫秒）'),
  searchLimit: integer(1).default(12).description('默认检索上限'),
  rebuildIndexOnWrite: z.boolean().default(true).description('写入后生成索引文件'),
})

export const Config = z.object(Object.fromEntries(
  Object.entries(SettingsSchema.dict).map(([key, field]) => [key, field.volatile()]),
))

export function readConfig(raw = {}) {
  return SettingsSchema(Object.fromEntries(Object.keys(SettingsSchema.dict).map((key) => {
    const value = raw[key]
    return [key, isVolatile(value) ? value.get() : value]
  })))
}

export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象')
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(SettingsSchema.dict, key)) throw new Error('未知配置字段：' + key)
  }
  const parsed = SettingsSchema(value)
  const { vaultPath } = resolvePaths(parsed)
  return { ...parsed, vaultPath, memoryRoot: parsed.memoryRoot.trim().replaceAll(String.fromCharCode(92), '/') }
}
