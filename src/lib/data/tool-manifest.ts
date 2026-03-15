export interface ToolInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const TOOLS: Record<string, ToolInfo> = {
  web_search: { id: 'web_search', name: 'Web Search', icon: '🔍', description: 'Search the web for information' },
  web_fetch: { id: 'web_fetch', name: 'Web Fetch', icon: '🌐', description: 'Fetch content from a URL' },
  browser: { id: 'browser', name: 'Browser', icon: '🖥️', description: 'Interact with web pages via a headless browser' },
  memory: { id: 'memory', name: 'Memory', icon: '🧠', description: 'Store and recall information across conversations' },
  image: { id: 'image', name: 'Image', icon: '🖼️', description: 'Generate or analyse images' },
  code_exec: { id: 'code_exec', name: 'Code Execution', icon: '⚙️', description: 'Execute code in a sandboxed environment' },
  file_read: { id: 'file_read', name: 'File Read', icon: '📄', description: 'Read files from the filesystem' },
  file_write: { id: 'file_write', name: 'File Write', icon: '✏️', description: 'Write files to the filesystem' },
  shell: { id: 'shell', name: 'Shell', icon: '💻', description: 'Execute shell commands' },
};

const FALLBACK: ToolInfo = { id: 'unknown', name: 'Unknown Tool', icon: '🔧', description: 'Custom tool' };

export function getToolInfo(toolId: string): ToolInfo {
  return TOOLS[toolId] ?? { ...FALLBACK, id: toolId, name: toolId };
}

export function getAllTools(): ToolInfo[] {
  return Object.values(TOOLS);
}
