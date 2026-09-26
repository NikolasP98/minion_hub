import type { FormulaAst, FormulaSourceDescriptor } from './contracts';

const precedence = (node: FormulaAst): number => {
  if (node.kind === 'case') return 1;
  if (node.kind !== 'binary') return node.kind === 'unary' ? 7 : 8;
  if (node.operator === 'OR') return 2;
  if (node.operator === 'AND') return 3;
  if (['=', '<>', '<', '<=', '>', '>='].includes(node.operator)) return 4;
  if (node.operator === '+' || node.operator === '-') return 5;
  return 6;
};
const quotedLabel = (value: string) => `"${value.replaceAll('"', '""')}"`;
const quotedText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Render a persisted stable-id AST using current labels without reparsing old labels. */
export function formatFormulaAst(
  ast: FormulaAst,
  sources: readonly FormulaSourceDescriptor[],
): string {
  const labels = new Map(sources.map((source) => [source.id, source.label]));
  const render = (node: FormulaAst, parent = 0): string => {
    const own = precedence(node);
    let text: string;
    if (node.kind === 'literal')
      text =
        node.valueType === 'null'
          ? 'NULL'
          : node.valueType === 'boolean'
            ? node.value
              ? 'TRUE'
              : 'FALSE'
            : node.valueType === 'text'
              ? quotedText(String(node.value))
              : String(node.value);
    else if (node.kind === 'reference')
      text = quotedLabel(labels.get(node.sourceId) ?? node.sourceId);
    else if (node.kind === 'unary')
      text =
        node.operator === 'NOT'
          ? `NOT ${render(node.operand, own)}`
          : `${node.operator}${render(node.operand, own)}`;
    else if (node.kind === 'binary') {
      const comparison = ['=', '<>', '<', '<=', '>', '>='].includes(node.operator);
      text = `${render(node.left, own + (comparison ? 1 : 0))} ${node.operator} ${render(node.right, own + (comparison || node.operator === '-' || node.operator === '/' ? 1 : 0))}`;
    } else if (node.kind === 'is_null')
      text = `${render(node.operand, own)} IS ${node.negated ? 'NOT ' : ''}NULL`;
    else if (node.kind === 'call')
      text = `${node.name}(${node.arguments.map((argument) => render(argument)).join(', ')})`;
    else
      text = `CASE ${node.branches.map((branch) => `WHEN ${render(branch.when)} THEN ${render(branch.then)}`).join(' ')} ELSE ${render(node.otherwise)} END`;
    return own < parent ? `(${text})` : text;
  };
  return render(ast);
}
