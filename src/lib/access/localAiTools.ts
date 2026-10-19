/** Local development tools only; a frontend flag can never enable a production build. */
export function localAiToolsEnabled(development: boolean, hostname: string, setting?: string): boolean {
  return development && ['localhost', '127.0.0.1'].includes(hostname) && setting !== 'false';
}

export const LOCAL_AI_TOOLS = localAiToolsEnabled(
  import.meta.env?.DEV === true,
  typeof window === 'undefined' ? '' : window.location.hostname,
  import.meta.env?.VITE_AI_DEV_TOOLS,
);
