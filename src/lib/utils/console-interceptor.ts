export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
  stack?: string;
}

const MAX_ENTRIES = 100;
const buffer: ConsoleEntry[] = [];

let installed = false;
let originals: Record<string, (...args: unknown[]) => void> = {};

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (typeof val === 'bigint') return `${val}n`;
      if (val instanceof Error) return `${val.name}: ${val.message}`;
      return val;
    });
  } catch {
    return String(value);
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(safeStringify).join(' ');
}

export function installInterceptor(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  const levels = ['log', 'warn', 'error', 'info'] as const;

  for (const level of levels) {
    const original = console[level].bind(console);
    originals[level] = original;

    console[level] = (...args: unknown[]) => {
      original(...args);

      const entry: ConsoleEntry = {
        level,
        message: formatArgs(args),
        timestamp: Date.now(),
      };

      if (level === 'error') {
        try {
          entry.stack = new Error().stack?.split('\n').slice(2, 6).join('\n');
        } catch {
          // ignore
        }
      }

      buffer.push(entry);
      if (buffer.length > MAX_ENTRIES) {
        buffer.splice(0, buffer.length - MAX_ENTRIES);
      }
    };
  }
}

export function getConsoleBuffer(): ConsoleEntry[] {
  return buffer.slice();
}

export function clearConsoleBuffer(): void {
  buffer.length = 0;
}
