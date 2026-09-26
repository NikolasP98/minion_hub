import {
  FORMULA_DEPTH_MAX,
  FORMULA_EXPRESSION_MAX,
  FORMULA_NODE_MAX,
  type FormulaAst,
  type FormulaDiagnostic,
  type FormulaSourceDescriptor,
} from './contracts';

type Token = {
  kind:
    'number' | 'string' | 'reference' | 'word' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'eof';
  text: string;
  from: number;
  to: number;
};
class FormulaParseError extends Error {
  constructor(readonly diagnostic: FormulaDiagnostic) {
    super(diagnostic.code);
  }
}
const diagnostic = (
  code: FormulaDiagnostic['code'],
  from: number,
  to: number,
  args?: Record<string, string | number>,
): FormulaDiagnostic => ({
  code,
  messageKey: `formula_${code}`,
  from,
  to,
  severity: 'error',
  args,
});

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const start = i;
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let value = '';
      let closed = false;
      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            value += quote;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += input[i++];
      }
      if (!closed) throw new FormulaParseError(diagnostic('syntax_error', start, i));
      out.push({ kind: quote === '"' ? 'reference' : 'string', text: value, from: start, to: i });
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const match = input.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (!match) throw new FormulaParseError(diagnostic('syntax_error', start, start + 1));
      i += match[0].length;
      out.push({ kind: 'number', text: match[0], from: start, to: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const match = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      i += match[0].length;
      out.push({ kind: 'word', text: match[0].toUpperCase(), from: start, to: i });
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      i++;
      out.push({
        kind: c === '(' ? 'lparen' : c === ')' ? 'rparen' : 'comma',
        text: c,
        from: start,
        to: i,
      });
      continue;
    }
    const op = input.slice(i).match(/^(?:<=|>=|<>|[+\-*/=<>])/);
    if (op) {
      i += op[0].length;
      out.push({ kind: 'operator', text: op[0], from: start, to: i });
      continue;
    }
    throw new FormulaParseError(diagnostic('syntax_error', start, start + 1));
  }
  out.push({ kind: 'eof', text: '', from: i, to: i });
  return out;
}

export function parseFormula(
  expression: string,
  sources: readonly FormulaSourceDescriptor[],
): { ast: FormulaAst | null; diagnostics: FormulaDiagnostic[] } {
  if (expression.length > FORMULA_EXPRESSION_MAX)
    return { ast: null, diagnostics: [diagnostic('expression_too_long', 0, expression.length)] };
  try {
    const tokens = tokenize(expression);
    let p = 0,
      nodes = 0;
    const peek = () => tokens[p];
    const take = () => tokens[p++];
    const word = (v: string) => peek().kind === 'word' && peek().text === v;
    const need = (kind: Token['kind'], text?: string) => {
      const t = peek();
      if (t.kind !== kind || (text && t.text !== text))
        throw new FormulaParseError(diagnostic('syntax_error', t.from, t.to));
      return take();
    };
    const node = <T extends FormulaAst>(value: T, depth: number): T => {
      if (++nodes > FORMULA_NODE_MAX)
        throw new FormulaParseError(diagnostic('node_limit', value.from, value.to));
      if (depth > FORMULA_DEPTH_MAX)
        throw new FormulaParseError(diagnostic('depth_limit', value.from, value.to));
      return value;
    };
    const resolve = (t: Token) => {
      const matches = sources.filter((s) => s.label === t.text || s.aliases.includes(t.text));
      if (!matches.length)
        throw new FormulaParseError(
          diagnostic('unknown_reference', t.from, t.to, { label: t.text }),
        );
      if (matches.length > 1)
        throw new FormulaParseError(
          diagnostic('ambiguous_reference', t.from, t.to, { label: t.text }),
        );
      return matches[0];
    };
    let parseExpression: (d?: number) => FormulaAst;
    const primary = (d: number): FormulaAst => {
      const t = peek();
      if (t.kind === 'number') {
        take();
        const value = Number(t.text);
        if (!Number.isFinite(value))
          throw new FormulaParseError(diagnostic('numeric_out_of_range', t.from, t.to));
        return node({ kind: 'literal', value, valueType: 'number', from: t.from, to: t.to }, d);
      }
      if (t.kind === 'string') {
        take();
        return node(
          { kind: 'literal', value: t.text, valueType: 'text', from: t.from, to: t.to },
          d,
        );
      }
      if (t.kind === 'reference') {
        take();
        return node({ kind: 'reference', sourceId: resolve(t).id, from: t.from, to: t.to }, d);
      }
      if (word('TRUE') || word('FALSE') || word('NULL')) {
        take();
        return node(
          {
            kind: 'literal',
            value: t.text === 'NULL' ? null : t.text === 'TRUE',
            valueType: t.text === 'NULL' ? 'null' : 'boolean',
            from: t.from,
            to: t.to,
          },
          d,
        );
      }
      if (word('CASE')) {
        const start = take();
        const branches = [];
        while (word('WHEN')) {
          take();
          const when = parseExpression(d + 1);
          need('word', 'THEN');
          const then = parseExpression(d + 1);
          branches.push({ when, then });
        }
        need('word', 'ELSE');
        const otherwise = parseExpression(d + 1);
        const end = need('word', 'END');
        if (!branches.length)
          throw new FormulaParseError(diagnostic('syntax_error', start.from, end.to));
        return node({ kind: 'case', branches, otherwise, from: start.from, to: end.to }, d);
      }
      if (t.kind === 'word') {
        const name = take();
        if (peek().kind !== 'lparen')
          throw new FormulaParseError(diagnostic('syntax_error', name.from, name.to));
        if (!['ROUND', 'ABS', 'COALESCE', 'NULLIF', 'LEAST', 'GREATEST'].includes(name.text))
          throw new FormulaParseError(
            diagnostic('unknown_function', name.from, name.to, { name: name.text }),
          );
        take();
        const args: FormulaAst[] = [];
        if (peek().kind !== 'rparen') {
          do {
            args.push(parseExpression(d + 1));
            if (peek().kind !== 'comma') break;
            take();
          } while (true);
        }
        const end = need('rparen');
        return node(
          {
            kind: 'call',
            name: name.text as Extract<FormulaAst, { kind: 'call' }>['name'],
            arguments: args,
            from: name.from,
            to: end.to,
          },
          d,
        );
      }
      if (t.kind === 'lparen') {
        take();
        const value = parseExpression(d + 1);
        need('rparen');
        return value;
      }
      throw new FormulaParseError(diagnostic('syntax_error', t.from, t.to));
    };
    const unary = (d: number): FormulaAst => {
      const t = peek();
      if ((t.kind === 'operator' && (t.text === '+' || t.text === '-')) || word('NOT')) {
        take();
        const operand = unary(d + 1);
        return node(
          {
            kind: 'unary',
            operator: t.text as '+' | '-' | 'NOT',
            operand,
            from: t.from,
            to: operand.to,
          },
          d,
        );
      }
      return primary(d);
    };
    const binary = (next: (d: number) => FormulaAst, ops: string[]) => (d: number) => {
      let left = next(d + 1);
      while ((peek().kind === 'operator' || peek().kind === 'word') && ops.includes(peek().text)) {
        const op = take();
        const right = next(d + 1);
        left = node(
          {
            kind: 'binary',
            operator: op.text as Extract<FormulaAst, { kind: 'binary' }>['operator'],
            left,
            right,
            from: left.from,
            to: right.to,
          },
          d,
        );
      }
      return left;
    };
    const mul = binary(unary, ['*', '/']);
    const add = binary(mul, ['+', '-']);
    const compare = (d: number) => {
      let left = add(d + 1);
      if (peek().kind === 'operator' && ['=', '<>', '<', '<=', '>', '>='].includes(peek().text)) {
        const op = take();
        const right = add(d + 1);
        left = node(
          {
            kind: 'binary',
            operator: op.text as Extract<FormulaAst, { kind: 'binary' }>['operator'],
            left,
            right,
            from: left.from,
            to: right.to,
          },
          d,
        );
      } else if (word('IS')) {
        take();
        let negated = false;
        if (word('NOT')) {
          take();
          negated = true;
        }
        const end = need('word', 'NULL');
        left = node({ kind: 'is_null', operand: left, negated, from: left.from, to: end.to }, d);
      }
      return left;
    };
    const and = binary(compare, ['AND']);
    const or = binary(and, ['OR']);
    parseExpression = (d = 1) => or(d);
    const ast = parseExpression();
    if (peek().kind !== 'eof')
      throw new FormulaParseError(diagnostic('syntax_error', peek().from, peek().to));
    return { ast, diagnostics: [] };
  } catch (e) {
    return {
      ast: null,
      diagnostics: [
        e instanceof FormulaParseError
          ? e.diagnostic
          : diagnostic('syntax_error', 0, expression.length),
      ],
    };
  }
}
