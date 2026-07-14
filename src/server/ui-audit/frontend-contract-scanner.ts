import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { discoverPageEndpoints } from './route-contract-filesystem';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

const SOURCE_EXTENSIONS = new Set(['.svelte', '.ts', '.js']);
const NON_NAV_PREFIXES = ['/api/', '/_app/', '/favicon', '/manifest', '/robots', '/sitemap'];

export interface SourceReference {
  sourceFile: string;
  line: number;
  value: string;
}

export interface ApiHandlerContract {
  pattern: string;
  sourceFile: string;
  methods: readonly HttpMethod[];
}

export interface FrontendApiCall extends SourceReference {
  method: HttpMethod;
  callee: 'fetch' | 'fetchJson' | 'jsonMutation';
}

export interface FrontendContractReport {
  pages: number;
  apiHandlers: number;
  navigationReferences: readonly SourceReference[];
  apiCalls: readonly FrontendApiCall[];
  unresolvedNavigation: readonly SourceReference[];
  unresolvedApiCalls: readonly FrontendApiCall[];
  ambiguousApiCalls: readonly (FrontendApiCall & { handlerPatterns: readonly string[] })[];
  methodMismatches: readonly (FrontendApiCall & {
    handlerPattern: string;
    methods: readonly HttpMethod[];
  })[];
}

function walkFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function sourceFiles(projectRoot: string): string[] {
  const root = join(projectRoot, 'src');
  return walkFiles(root)
    .filter((file) => SOURCE_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))))
    .filter((file) => !/\.(?:test|spec)\.[jt]s$/.test(file))
    .filter((file) => !file.includes(`${sep}paraglide${sep}`))
    .filter((file) => !file.includes(`${sep}server${sep}`))
    .filter((file) => !/\+server\.[jt]s$/.test(file))
    .sort();
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function routePattern(root: string, directory: string): string {
  const segments = relative(root, directory)
    .split(sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

function quotedValue(expression: string): string | undefined {
  const trimmed = expression.trim();
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;
  let escaped = false;
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char !== quote) continue;
    const literal = trimmed.slice(1, index);
    if (!literal.startsWith('/')) return undefined;
    return literal.replace(/\$\{[^}]+\}/g, '__DYNAMIC__');
  }
  return undefined;
}

function splitTopLevel(text: string): string[] {
  const output: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let escaped = false;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '(') parentheses += 1;
    else if (char === ')') parentheses -= 1;
    else if (char === ',' && braces === 0 && brackets === 0 && parentheses === 0) {
      output.push(text.slice(start, index));
      start = index + 1;
    }
  }
  output.push(text.slice(start));
  return output;
}

function callBody(
  source: string,
  openParenthesis: number,
): { body: string; end: number } | undefined {
  let quote: string | null = null;
  let escaped = false;
  let depth = 1;
  for (let index = openParenthesis + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(openParenthesis + 1, index), end: index };
    }
  }
  return undefined;
}

function methodsFrom(text: string): HttpMethod[] {
  const expression = text.match(/\bmethod\s*:\s*([^,}\n]+)/)?.[1];
  if (!expression) return [];
  const values = [...expression.matchAll(/['"]([A-Za-z]+)['"]/g)].map((match) =>
    match[1].toUpperCase(),
  );
  return [...new Set(values.flatMap((value) => HTTP_METHODS.filter((method) => method === value)))];
}

function extractDirectApiCalls(sourceFile: string, source: string): FrontendApiCall[] {
  const output: FrontendApiCall[] = [];
  const expression = /\b(fetchJson|fetch)\s*(?:<[^;()\n]*>)?\s*\(/g;
  for (const match of source.matchAll(expression)) {
    const openParenthesis = (match.index ?? 0) + match[0].lastIndexOf('(');
    const call = callBody(source, openParenthesis);
    if (!call) continue;
    const args = splitTopLevel(call.body);
    const value = quotedValue(args[0] ?? '');
    if (!value?.startsWith('/api/')) continue;
    const options = args.slice(1).join(',');
    const declaredMethods = methodsFrom(options);
    if (/\bmethod\s*:/.test(options) && declaredMethods.length === 0) continue;
    for (const method of declaredMethods.length > 0 ? declaredMethods : ['GET' as const]) {
      output.push({
        sourceFile,
        line: lineAt(source, match.index ?? 0),
        value,
        method,
        callee: match[1] as 'fetch' | 'fetchJson',
      });
    }
  }
  return output;
}

function extractJsonMutations(sourceFile: string, source: string): FrontendApiCall[] {
  const output: FrontendApiCall[] = [];
  const expression = /\bjsonMutation\s*(?:<[^;()\n]*>)?\s*\(/g;
  for (const match of source.matchAll(expression)) {
    const openParenthesis = (match.index ?? 0) + match[0].lastIndexOf('(');
    const call = callBody(source, openParenthesis);
    if (!call) continue;
    const input = call.body.match(/\binput\s*:\s*([^,\n]+)/)?.[1];
    const value = input ? quotedValue(input) : undefined;
    const methods = methodsFrom(call.body);
    if (!value?.startsWith('/api/') || methods.length === 0) continue;
    for (const method of methods) {
      output.push({
        sourceFile,
        line: lineAt(source, match.index ?? 0),
        value,
        method,
        callee: 'jsonMutation',
      });
    }
  }
  return output;
}

function extractNavigation(sourceFile: string, source: string): SourceReference[] {
  const output: SourceReference[] = [];
  const expressions = [
    /\bhref\s*=\s*(['"`])([^'"`\n]+)\1/g,
    /\b(?:href|path)\s*:\s*(['"`])([^'"`\n]+)\1/g,
    /\b(?:goto|replaceState|pushState)\s*\(\s*(['"`])([^'"`\n]+)\1/g,
  ];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const raw = match[2];
      if (!raw.startsWith('/') || raw.startsWith('//')) continue;
      const value = raw.replace(/\$\{[^}]+\}/g, '__DYNAMIC__');
      if (NON_NAV_PREFIXES.some((prefix) => value.startsWith(prefix))) continue;
      output.push({ sourceFile, line: lineAt(source, match.index ?? 0), value });
    }
  }
  return output;
}

function normalizedPath(value: string): string {
  return value.split(/[?#]/, 1)[0] || '/';
}

function routeValueMatchesPattern(value: string, pattern: string): boolean {
  const valueSegments = value.split('/').filter(Boolean);
  const patternSegments = pattern.split('/').filter(Boolean);
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    if (/^\[\.\.\.[^\]]+\]$/.test(expected)) return valueSegments.length > index;
    const actual = valueSegments[index];
    if (actual === undefined) return false;
    if (/^\[[^\]]+\]$/.test(expected) || actual === '__DYNAMIC__') continue;
    if (actual !== expected) return false;
  }
  return valueSegments.length === patternSegments.length;
}

function routeCandidates(value: string): string[] {
  const path = normalizedPath(value);
  const dynamicSuffix = path.lastIndexOf('__DYNAMIC__');
  const isAttachedSuffix = dynamicSuffix > 0 && path[dynamicSuffix - 1] !== '/';
  return isAttachedSuffix ? [path, path.slice(0, dynamicSuffix)] : [path];
}

function patternSpecificity(value: string, pattern: string): number {
  const valueSegments = value.split('/').filter(Boolean);
  const patternSegments = pattern.split('/').filter(Boolean);
  let score = patternSegments.length;
  for (let index = 0; index < patternSegments.length; index += 1) {
    const actual = valueSegments[index];
    const expected = patternSegments[index];
    if (actual === '__DYNAMIC__') {
      score += /^\[[^\]]+\]$/.test(expected) ? 50 : 10;
    } else if (actual === expected) {
      score += 100;
    } else if (/^\[\.\.\.[^\]]+\]$/.test(expected)) {
      score += 5;
    } else if (/^\[[^\]]+\]$/.test(expected)) {
      score += 20;
    }
  }
  return score;
}

function matchingPatternScores(value: string, patterns: readonly string[]): [string, number][] {
  const matches = new Map<string, number>();
  for (const candidate of routeCandidates(value)) {
    for (const pattern of patterns) {
      if (!routeValueMatchesPattern(candidate, pattern)) continue;
      const score = patternSpecificity(candidate, pattern);
      matches.set(pattern, Math.max(score, matches.get(pattern) ?? Number.NEGATIVE_INFINITY));
    }
  }
  return [...matches.entries()].sort(
    ([leftPattern, leftScore], [rightPattern, rightScore]) =>
      rightScore - leftScore || leftPattern.localeCompare(rightPattern),
  );
}

function matchingPatterns(value: string, patterns: readonly string[]): string[] {
  return matchingPatternScores(value, patterns).map(([pattern]) => pattern);
}

function matchingPattern(value: string, patterns: readonly string[]): string | undefined {
  return matchingPatterns(value, patterns)[0];
}

export function discoverApiHandlers(projectRoot: string): ApiHandlerContract[] {
  const apiRoot = join(projectRoot, 'src', 'routes', 'api');
  return walkFiles(apiRoot)
    .filter((file) => /\+server\.[jt]s$/.test(file))
    .map((file) => {
      const source = readFileSync(file, 'utf8');
      const methods = HTTP_METHODS.filter((method) =>
        new RegExp(`\\bexport\\s+(?:const|function)\\s+${method}\\b`).test(source),
      );
      return {
        pattern: routePattern(
          join(projectRoot, 'src', 'routes'),
          file.slice(0, -(basename(file).length + 1)),
        ),
        sourceFile: relative(projectRoot, file).split(sep).join('/'),
        methods,
      };
    })
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
}

export function scanFrontendContracts(projectRoot: string): FrontendContractReport {
  const pages = discoverPageEndpoints(projectRoot);
  const handlers = discoverApiHandlers(projectRoot);
  const navigationReferences: SourceReference[] = [];
  const apiCalls: FrontendApiCall[] = [];
  for (const file of sourceFiles(projectRoot)) {
    const sourceFile = relative(projectRoot, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    navigationReferences.push(...extractNavigation(sourceFile, source));
    apiCalls.push(...extractDirectApiCalls(sourceFile, source));
    apiCalls.push(...extractJsonMutations(sourceFile, source));
  }

  const pagePatterns = pages.map((page) => page.pattern);
  const apiPatterns = handlers.map((handler) => handler.pattern);
  const unresolvedNavigation = navigationReferences.filter((reference) => {
    const path = normalizedPath(reference.value);
    return path !== '/' && !matchingPattern(path, pagePatterns);
  });
  const unresolvedApiCalls: FrontendApiCall[] = [];
  const ambiguousApiCalls: FrontendContractReport['ambiguousApiCalls'][number][] = [];
  const methodMismatches: FrontendContractReport['methodMismatches'][number][] = [];
  for (const call of apiCalls) {
    const handlerScores = matchingPatternScores(call.value, apiPatterns);
    if (handlerScores.length === 0) {
      unresolvedApiCalls.push(call);
      continue;
    }
    const topScore = handlerScores[0][1];
    const handlerPatterns = handlerScores
      .filter(([, score]) => score === topScore)
      .map(([pattern]) => pattern);
    if (handlerPatterns.length > 1) ambiguousApiCalls.push({ ...call, handlerPatterns });
    const compatibleHandlers = handlerPatterns
      .map((pattern) => handlers.find((candidate) => candidate.pattern === pattern))
      .filter((handler): handler is ApiHandlerContract => handler !== undefined);
    const incompatibleHandler = compatibleHandlers.find(
      (handler) => !handler.methods.includes(call.method),
    );
    if (incompatibleHandler) {
      methodMismatches.push({
        ...call,
        handlerPattern: incompatibleHandler.pattern,
        methods: incompatibleHandler.methods,
      });
    }
  }

  const byLocation = <T extends SourceReference>(left: T, right: T) =>
    left.sourceFile.localeCompare(right.sourceFile) || left.line - right.line;
  return {
    pages: pages.length,
    apiHandlers: handlers.length,
    navigationReferences: navigationReferences.sort(byLocation),
    apiCalls: apiCalls.sort(byLocation),
    unresolvedNavigation: unresolvedNavigation.sort(byLocation),
    unresolvedApiCalls: unresolvedApiCalls.sort(byLocation),
    ambiguousApiCalls: ambiguousApiCalls.sort(byLocation),
    methodMismatches: methodMismatches.sort(byLocation),
  };
}
