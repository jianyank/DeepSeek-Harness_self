export const name = 'cache-prefix';
export const inject = ['systemPrompt'];

// Object key order is irrelevant to JSON Schema; array order and string bytes are not.
function stableKeys(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let items;
    value.forEach((item, i) => {
      const next = stableKeys(item);
      if (next !== item) {
        items ??= value.slice();
        items[i] = next;
      }
    });
    return items ?? value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const keys = Object.keys(value);
  if (keys.some((key, i) => i > 0 && keys[i - 1] > key)) {
    return Object.fromEntries(keys.sort().map(key => [key, stableKeys(value[key])]));
  }
  let result;
  for (const key of keys) {
    const next = stableKeys(value[key]);
    if (next !== value[key]) {
      result ??= { ...value };
      result[key] = next;
    }
  }
  return result ?? value;
}

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    // Read the final selection after scoped model-selection hooks have run.
    if (assembly.variables.provider !== 'deepseek-official') return assembly;
    const tools = assembly.tools.map(tool => {
      const parameters = stableKeys(tool.parameters);
      return parameters === tool.parameters ? tool : { ...tool, parameters };
    });
    return tools.every((tool, i) => tool === assembly.tools[i]) ? assembly : { ...assembly, tools };
  }, { prepend: true });
}
