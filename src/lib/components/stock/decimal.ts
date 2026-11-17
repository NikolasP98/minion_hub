/** Exact decimal product of two plain decimal strings (`-12.50`), no float noise. Null if either is not a plain decimal. */
const DEC = /^(-?)(\d+)(?:\.(\d+))?$/;

export function mulDecimal(a: string, b: string): string | null {
  const x = DEC.exec(a.trim());
  const y = DEC.exec(b.trim());
  if (!x || !y) return null;
  const scale = (x[3]?.length ?? 0) + (y[3]?.length ?? 0);
  const prod = BigInt(x[2] + (x[3] ?? '')) * BigInt(y[2] + (y[3] ?? ''));
  const neg = (x[1] === '-') !== (y[1] === '-') && prod !== 0n;
  const digits = prod.toString().padStart(scale + 1, '0');
  let out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  if (scale) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return neg ? `-${out}` : out;
}
