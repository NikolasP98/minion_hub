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

/** Last resort for a value that defeats both JSON and string coercion. */
const UNSERIALIZABLE = '[unserializable]';

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
    // A hostile value can defeat `String()` as well — a throwing `toString`,
    // `valueOf` or `Symbol.toPrimitive`, or a null-prototype object. This is a
    // reporting sink: it must never turn the failure it is reporting into a new
    // one, so coercion gets its own guard and a constant last resort.
    try {
      return String(value);
    } catch {
      return UNSERIALIZABLE;
    }
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

      // Capture is best-effort bookkeeping layered on a console call that has
      // already happened. Nothing below may throw back into the caller, or a
      // report ABOUT a failure becomes a second failure at the reporting site.
      try {
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
      } catch {
        // Drop the entry rather than propagate; the console call itself stands.
      }
    };
  }
}

export function getConsoleBuffer(): ConsoleEntry[] {
  return buffer.slice();
}
