import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(root, entry.name);
    return entry.isDirectory()
      ? files(name)
      : name.endsWith('.svelte') && !/fixture|harness|_test/i.test(name)
        ? [name]
        : [];
  });
}
/** Detect controlled edits backed by async writes. Local bind/draft controls,
 * navigation filters and explicit create/post/charge actions are separate. */
export function inventory(source, filename = 'Component.svelte') {
  const ast = parse(source, { modern: true, filename });
  const script = ast.instance
    ? source.slice(ast.instance.content.start, ast.instance.content.end)
    : '';
  const sf = ts.createSourceFile(
    filename + '.ts',
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const functions = new Map();
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(sf));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      functions.set(node.name.text, node.initializer.getText(sf));
    ts.forEachChild(node, collect);
  }
  collect(sf);
  const expanded = (expression, depth = 0, seen = new Set(), aliases = new Map()) => {
    if (depth > 4) return expression;
    let result = expression;
    for (const match of expression.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0];
      if (
        expression[match.index - 1] === '.' &&
        expression.slice(match.index - 3, match.index) !== '...'
      )
        continue;
      if (seen.has(name) || (!aliases.has(name) && !functions.has(name))) continue;
      seen.add(name);
      result += '\n' + expanded(aliases.get(name) ?? functions.get(name), depth + 1, seen, aliases);
    }
    return result;
  };
  const found = [];
  function walk(node, inherited = new Map()) {
    const aliases = new Map(inherited);
    if (node?.type === 'EachBlock' && node.context?.type === 'Identifier')
      aliases.set(node.context.name, source.slice(node.expression.start, node.expression.end));
    if (node?.type === 'ConstTag')
      for (const declaration of node.declaration.declarations)
        if (declaration.id.type === 'Identifier' && declaration.init)
          inherited.set(
            declaration.id.name,
            source.slice(declaration.init.start, declaration.init.end),
          );
    if (!node || typeof node !== 'object') return;
    if (['Component', 'RegularElement'].includes(node.type)) {
      const name = node.name;
      const attrs = node.attributes ?? [];
      const controlled = attrs.filter(
        (attr) => attr.type === 'Attribute' && ['checked', 'value'].includes(attr.name),
      );
      const change = attrs.find(
        (attr) =>
          attr.type === 'Attribute' && ['onchange', 'onblur', 'oninput'].includes(attr.name),
      );
      // Component names are open-ended. Every controlled value uses this
      // contract, so a new wrapper cannot bypass the gate by changing its name.
      if (controlled.length && change) {
        const text = source.slice(node.start, node.end);
        const callback = source.slice(change.start, change.end);
        const body = expanded(callback, 0, new Set(), aliases);
        const values = controlled.map((attr) => source.slice(attr.start, attr.end)).join(' ');
        const mutation =
          /\b(fetch|fetchJson|jsonMutation|patchJson|putJson|sendRequest|setAgentSkills|runCheckedMutation)\s*\(/.test(
            body,
          );
        const tagContract = name === 'TagsField' && !/\bvoid\s/.test(body);
        const immediate =
          tagContract ||
          /\b(createAutosave|createOptimistic|createOptimisticCell)\b/.test(
            expanded(values, 0, new Set(), aliases),
          ) ||
          /\.(set|run)\(/.test(callback);
        const navigation =
          /\b(goto|replaceState)\s*\(/.test(body) &&
          !/method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(body);
        if (mutation && !immediate && !navigation) {
          found.push({
            file: filename,
            line: source.slice(0, node.start).split('\n').length,
            control: name,
            value: values,
            handler: callback,
            source: text.slice(0, 400),
          });
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['parent', 'loc', 'attributes'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => walk(child, aliases));
      else if (value && typeof value === 'object') walk(value, aliases);
    }
  }
  walk(ast.fragment);
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = files('src').flatMap((file) => inventory(readFileSync(file, 'utf8'), file));
  if (process.argv.includes('--inventory')) console.log(JSON.stringify(findings, null, 2));
  else {
    const policies = JSON.parse(readFileSync('scripts/optimistic-controls-policy.json', 'utf8'));
    const counts = new Map();
    const key = (item) => JSON.stringify([item.file, item.value, item.handler]);
    const allowed = new Map(policies.map((policy) => [key(policy), policy]));
    const violations = findings.filter((finding) => {
      const id = key(finding);
      const policy = allowed.get(id);
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      return !policy || count > policy.cap;
    });
    for (const finding of violations)
      console.error(
        `${finding.file}:${finding.line} ${finding.control}: async controlled edit needs an optimistic value and pending/rollback feedback`,
      );
    if (violations.length) process.exitCode = 1;
    else
      console.log(
        `Optimistic control gate: no new server-waiting edits; ${findings.length} explicitly reviewed control policies.`,
      );
  }
}
