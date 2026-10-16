export const name = 'runtime-tuning';
export const inject = ['systemPrompt'];

const coding = 'Inspect code/callers/instructions; resolve doubts before edits. Use the smallest correct change; existing patterns; brief comments; no needless abstractions. Reproduce bugs, run checks/regressions, fix failures; report evidence/unverified gaps. Reuse reads, batch independent work; no verbose plans or unchanged retries.';
const tasks = new Map([
  ["The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs.",
    'Self-contained: goal, context/files, scope, constraints, acceptance checks. For code, edit within scope; return changed paths, checks, blockers.'],
  ["The task for the subagent. It already sees this conversation's completed turns, so build on them freely and state only what is new.",
    'Use completed turns; add current turn context, goal, scope, constraints, acceptance checks. For code, edit within scope; return changed paths, checks, blockers.']
]);

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next();
    const sections = assembly.variables.provider === 'deepseek-official'
      && !assembly.sections.some(s => s.name === 'runtime-tuning:coding')
      ? [...assembly.sections, { name: 'runtime-tuning:coding', text: coding }] : assembly.sections;
    const tools = assembly.tools.map(tool => {
      const prompt = tool.parameters?.properties?.prompt;
      const description = tasks.get(prompt?.description);
      if (!description) return tool;
      return { ...tool, parameters: { ...tool.parameters, properties: {
        ...tool.parameters.properties, prompt: { ...prompt, description }
      } } };
    });
    return sections === assembly.sections && tools.every((tool, i) => tool === assembly.tools[i])
      ? assembly : { ...assembly, sections, tools };
  }, { prepend: true });
}
