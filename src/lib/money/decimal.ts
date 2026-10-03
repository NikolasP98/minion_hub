/**
 * Exact decimal arithmetic shared by browser drafts and server money boundaries.
 *
 * A Number means its canonical decimal spelling; precision lost before this
 * boundary cannot be recovered. Quantization rounds halfway away from zero.
 * Currency policy, field limits and domain errors belong to the calling adapter.
 */
export type DecimalInput = string | number;
export type DecimalErrorReason =
  'invalid_decimal' | 'decimal_limit' | 'invalid_scale' | 'invalid_count' | 'unsafe_number';

export class DecimalInputError extends Error {
  constructor(readonly reason: DecimalErrorReason) {
    // Never include the supplied value: this error also crosses telemetry paths.
    super(reason);
    this.name = 'DecimalInputError';
  }
}

interface Decimal {
  coefficient: bigint;
  exponent: number;
}

const MAX_INTERMEDIATE_DIGITS = 128;
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const ABS = (value: bigint) => (value < 0n ? -value : value);

function scaleOf(scale: number): number {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    throw new DecimalInputError('invalid_scale');
  }
  return scale;
}

function bounded(value: bigint): bigint {
  if (typeof value !== 'bigint' || ABS(value).toString().length > MAX_INTERMEDIATE_DIGITS) {
    throw new DecimalInputError('decimal_limit');
  }
  return value;
}

function power(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_INTERMEDIATE_DIGITS) {
    throw new DecimalInputError('decimal_limit');
  }
  return 10n ** BigInt(exponent);
}

function parse(input: DecimalInput): Decimal {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new DecimalInputError('invalid_decimal');
  }
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new DecimalInputError('invalid_decimal');
  }
  const raw = String(input);
  if (raw.length > 80) throw new DecimalInputError('decimal_limit');
  // Only surrounding ASCII whitespace is permitted; String.trim accepts more.
  const text = raw.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '');
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new DecimalInputError('invalid_decimal');
  const fraction = match[3] ?? match[4] ?? '';
  const digits = (match[2] ?? '') + fraction;
  const exponent = Number(match[5] ?? '0');
  // Count padding too: a large coefficient never reaches BigInt construction.
  if (digits.length > 40 || !Number.isInteger(exponent) || Math.abs(exponent) > 18) {
    throw new DecimalInputError('decimal_limit');
  }
  return {
    coefficient: BigInt(`${match[1] === '-' ? '-' : ''}${digits}`),
    exponent: exponent - fraction.length,
  };
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new DecimalInputError('invalid_decimal');
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const n = ABS(numerator);
  const d = ABS(denominator);
  return bounded(sign * (n / d + ((n % d) * 2n >= d ? 1n : 0n)));
}

function quantize(value: Decimal, scale: number): bigint {
  const shift = value.exponent + scaleOf(scale);
  return shift >= 0
    ? bounded(value.coefficient * power(shift))
    : roundRatio(value.coefficient, power(-shift));
}

function equal(left: Decimal, right: Decimal): boolean {
  const exponent = Math.min(left.exponent, right.exponent);
  return (
    left.coefficient * power(left.exponent - exponent) ===
    right.coefficient * power(right.exponent - exponent)
  );
}

/** Quantize the original decimal value once, without a binary multiply. */
export function decimalToMinor(input: DecimalInput, scale = 2): bigint {
  return quantize(parse(input), scale);
}

/** Discounts and agreed schedule rows must already be exact at their scale. */
export function decimalToMinorExact(input: DecimalInput, scale = 2): bigint {
  const value = parse(input);
  const minor = quantize(value, scale);
  if (!equal(value, { coefficient: minor, exponent: -scale })) {
    throw new DecimalInputError('invalid_decimal');
  }
  return minor;
}

/** Checked unrounded conversion for quantities/prices and numeric wire DTOs. */
export function decimalToNumber(input: DecimalInput): number {
  const value = parse(input);
  const number = Number(typeof input === 'string' ? input : String(input));
  try {
    if (!Number.isFinite(number) || !equal(value, parse(number))) {
      throw new DecimalInputError('unsafe_number');
    }
  } catch {
    throw new DecimalInputError('unsafe_number');
  }
  return Object.is(number, -0) ? 0 : number;
}

/** Fixed-scale database spelling. There is no negative-zero representation. */
export function minorToDecimal(minor: bigint, scale = 2): string {
  scaleOf(scale);
  bounded(minor);
  const digits = ABS(minor)
    .toString()
    .padStart(scale + 1, '0');
  const unsigned = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return minor < 0n ? `-${unsigned}` : unsigned;
}

/** Number compatibility requires both safe cents AND a decimal round-trip. */
export function minorToNumber(minor: bigint, scale = 2): number {
  if (ABS(bounded(minor)) > MAX_SAFE_MINOR) throw new DecimalInputError('unsafe_number');
  return decimalToNumber(minorToDecimal(minor, scale));
}

/** Sum original decimal operands exactly, then quantize the aggregate once. */
export function sumDecimalToMinor(inputs: readonly DecimalInput[], scale = 2): bigint {
  scaleOf(scale);
  if (inputs.length > 10_000) throw new DecimalInputError('invalid_count');
  let total: Decimal = { coefficient: 0n, exponent: 0 };
  for (const input of inputs) {
    const next = parse(input);
    const exponent = Math.min(total.exponent, next.exponent);
    total = {
      coefficient: bounded(
        total.coefficient * power(total.exponent - exponent) +
          next.coefficient * power(next.exponent - exponent),
      ),
      exponent,
    };
  }
  return quantize(total, scale);
}

/** Multiply unrounded operands, then quantize once at the line boundary. */
export function multiplyDecimalToMinor(left: DecimalInput, right: DecimalInput, scale = 2): bigint {
  const a = parse(left);
  const b = parse(right);
  return quantize(
    { coefficient: bounded(a.coefficient * b.coefficient), exponent: a.exponent + b.exponent },
    scale,
  );
}

/** Exact rational division; no binary quotient is formed before rounding. */
export function divideDecimalToMinor(
  numerator: DecimalInput,
  denominator: DecimalInput,
  scale = 2,
): bigint {
  const a = parse(numerator);
  const b = parse(denominator);
  const shift = a.exponent - b.exponent + scaleOf(scale);
  return roundRatio(
    shift >= 0 ? bounded(a.coefficient * power(shift)) : a.coefficient,
    shift < 0 ? bounded(b.coefficient * power(-shift)) : b.coefficient,
  );
}

/** Truncate toward zero, then assign signed residual units to the first slots. */
export function allocateMinorUnits(total: bigint, count: number): bigint[] {
  bounded(total);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) {
    throw new DecimalInputError('invalid_count');
  }
  const divisor = BigInt(count);
  const base = total / divisor;
  const remainder = ABS(total % divisor);
  const direction = total < 0n ? -1n : 1n;
  return Array.from(
    { length: count },
    (_, index) => base + (BigInt(index) < remainder ? direction : 0n),
  );
}
