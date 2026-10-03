import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const serviceRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(serviceRoot, '../../..');

type RuntimeGraph = Map<string, Set<string>>;

function productionFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (entry !== '__fixtures__') files.push(...productionFiles(absolute));
      continue;
    }
    if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.integration.test.ts')
    )
      files.push(absolute);
  }
  return files;
}

function moduleId(file: string): string {
  return relative(serviceRoot, file).split(sep).join('/');
}

function resolveRuntimeImport(
  importer: string,
  specifier: string,
  files: Set<string>,
): string | null {
  let candidate: string;
  if (specifier.startsWith('.')) candidate = resolve(dirname(importer), specifier);
  else if (specifier.startsWith('$server/'))
    candidate = resolve(projectRoot, 'src/server', specifier.slice('$server/'.length));
  else return null;

  if (candidate.endsWith('.js')) candidate = candidate.slice(0, -3);
  for (const possible of [candidate, `${candidate}.ts`, resolve(candidate, 'index.ts')]) {
    if (files.has(possible)) return possible;
  }
  return null;
}

function emittedSpecifiers(source: string, fileName: string): string[] {
  const emitted = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const parsed = ts.createSourceFile(
    fileName.replace(/\.ts$/, '.js'),
    emitted,
    ts.ScriptTarget.ES2022,
  );
  const specifiers: string[] = [];
  for (const statement of parsed.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    )
      specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers;
}

function runtimeGraph(): RuntimeGraph {
  const sourceFiles = productionFiles(serviceRoot);
  const fileSet = new Set(sourceFiles);
  const graph: RuntimeGraph = new Map();
  for (const file of sourceFiles) {
    const edges = new Set<string>();
    for (const specifier of emittedSpecifiers(readFileSync(file, 'utf8'), file)) {
      const target = resolveRuntimeImport(file, specifier, fileSet);
      if (target) edges.add(moduleId(target));
    }
    graph.set(moduleId(file), edges);
  }
  return graph;
}

function stronglyConnectedComponents(graph: RuntimeGraph): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!graph.has(target)) continue;
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(target)!));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    components.push(component.sort());
  }

  for (const node of graph.keys()) if (!indexes.has(node)) visit(node);
  return components;
}

const boundaryModules = [
  'pos.service.ts',
  'pos-accounts.service.ts',
  'pos-emission.service.ts',
  'pos/actor.ts',
  'pos/db-errors.ts',
  'pos/settings.ts',
  'pos/accounts/decoders.ts',
  'pos/accounts/detail.ts',
  'pos/accounts/identity-key.ts',
  'pos/accounts/list.ts',
  'pos/accounts/plan-detail.ts',
  'pos/accounts/resolve.ts',
  'pos/accounts/types.ts',
] as const;

const posRuntimeExports = [
  'DEFAULT_POS_SETTINGS',
  'PosError',
  'REQUIREMENT_ERROR_CODE',
  'REQUIREMENT_KINDS',
  'REQUIREMENT_LEVELS',
  'closeShift',
  'computeExpected',
  'computeTicketTotals',
  'createSellable',
  'deleteBundleComponent',
  'deriveSellableFacts',
  'emissionAllowedByMethods',
  'getOpenShift',
  'getPackageValidityDays',
  'getPosCurrencyInTx',
  'getPosSettings',
  'getPosSettingsInTx',
  'getTicket',
  'isUniqueViolation',
  'listBundleEdges',
  'listSellables',
  'listShifts',
  'listTicketRefs',
  'listTickets',
  'loadComponentGraph',
  'missingRequirements',
  'normalizeMethods',
  'normalizeRequirements',
  'openShift',
  'packageValidityDays',
  'postTicketStock',
  'previewTicket',
  'recipeBottleneck',
  'setBundleComponent',
  'setPackageValidityDays',
  'shiftSummary',
  'slugifyCode',
  'submitTicket',
  'updatePosSettings',
  'updateSellable',
  'voidTicket',
] as const;

const accountRuntimeExports = [
  'LEDGER_KINDS',
  'PLAN_STATUSES',
  'addLedgerEntry',
  'addLedgerEntryInTx',
  'cancelPlan',
  'clientKeyOf',
  'countPendingSchedulingLines',
  'createPlan',
  'creditBalance',
  'creditBalances',
  'getClientAccountDetail',
  'getPlan',
  'listClientAccounts',
  'listLedger',
  'listPartyPaidServices',
  'listPendingSchedulingLines',
  'listPlans',
  'listTicketsForCalendar',
  'parseClientKey',
  'resolveClientAccount',
  'settlePlanIfPaid',
] as const;

const posTypeExports = [
  'Actor',
  'BundleEdge',
  'EmissionSettings',
  'PaymentMethod',
  'PosRequirements',
  'PosSettings',
  'PosSettingsPatch',
  'PosSettingsRead',
  'RequirementKind',
  'RequirementLevel',
  'SellableInput',
  'SellableRow',
  'ShiftSummary',
  'StockShortfallLine',
  'StockWarning',
  'SubmitTicketInput',
  'TicketLineInput',
  'TicketPaymentInput',
  'TicketRef',
] as const;

const accountTypeExports = [
  'CalendarTicket',
  'ClientAccountDetail',
  'ClientAccountSummary',
  'ClientRef',
  'CurrencyBalance',
  'CurrencyPlanBucket',
  'LedgerEntryInput',
  'LedgerKind',
  'PaidServiceRow',
  'PendingSchedulingLine',
  'PlanDetail',
  'PlanInput',
  'PlanStatus',
  'WalletIdentityStatus',
] as const;

function publicTypeExports(files: string[]): Map<string, string[]> {
  const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error(`Missing tsconfig.json below ${projectRoot}`);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
  const program = ts.createProgram({ rootNames: files, options: parsed.options });
  const checker = program.getTypeChecker();
  const result = new Map<string, string[]>();

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`TypeScript program did not load ${file}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`TypeScript checker found no module symbol for ${file}`);
    const names = checker
      .getExportsOfModule(moduleSymbol)
      .filter((symbol) => {
        const target =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return (
          Boolean(target.flags & ts.SymbolFlags.Type) &&
          !Boolean(target.flags & ts.SymbolFlags.Value)
        );
      })
      .map((symbol) => symbol.getName())
      .sort();
    result.set(file, names);
  }

  return result;
}

describe('POS service extraction boundaries', () => {
  it('has an acyclic emitted-runtime graph through both barrels and every extracted leaf', () => {
    const graph = runtimeGraph();
    for (const module of boundaryModules) expect(graph.has(module), module).toBe(true);

    // These edges prove the graph is tracing emitted imports/re-exports rather
    // than merely declaring every target independent.
    expect(graph.get('pos.service.ts')?.has('pos-accounts.service.ts')).toBe(true);
    expect(graph.get('pos.service.ts')?.has('pos-emission.service.ts')).toBe(true);
    expect(graph.get('pos/settings.ts')?.has('pos-emission.service.ts')).toBe(true);
    expect(graph.get('pos-accounts.service.ts')?.has('pos/accounts/detail.ts')).toBe(true);

    const components = stronglyConnectedComponents(graph);
    for (const module of boundaryModules) {
      const component = components.find((members) => members.includes(module));
      expect(component, module).toEqual([module]);
    }

    // Explicit type-only dependencies must disappear from emitted JavaScript.
    expect(graph.get('pos-packages.service.ts')?.has('pos-accounts.service.ts')).toBe(false);
    expect(graph.get('pos-emission.service.ts')?.has('pos/settings.ts')).toBe(false);

    // Mutation canaries: restoring either removed back-edge creates the exact
    // cycles this guard is meant to reject.
    const emissionMutation = new Map([...graph].map(([node, edges]) => [node, new Set(edges)]));
    emissionMutation.get('pos-emission.service.ts')!.add('pos.service.ts');
    expect(
      stronglyConnectedComponents(emissionMutation).some(
        (members) =>
          members.includes('pos.service.ts') && members.includes('pos-emission.service.ts'),
      ),
    ).toBe(true);

    const accountMutation = new Map([...graph].map(([node, edges]) => [node, new Set(edges)]));
    accountMutation.get('pos/accounts/detail.ts')!.add('pos-accounts.service.ts');
    expect(
      stronglyConnectedComponents(accountMutation).some(
        (members) =>
          members.includes('pos-accounts.service.ts') && members.includes('pos/accounts/detail.ts'),
      ),
    ).toBe(true);
  }, 15_000);

  it('plain-loads both public barrels and every extracted leaf with the frozen runtime exports', async () => {
    const [pos, accounts] = await Promise.all([
      import('./pos.service'),
      import('./pos-accounts.service'),
    ]);
    await Promise.all([
      import('./pos/actor'),
      import('./pos/db-errors'),
      import('./pos/settings'),
      import('./pos/accounts/decoders'),
      import('./pos/accounts/detail'),
      import('./pos/accounts/identity-key'),
      import('./pos/accounts/list'),
      import('./pos/accounts/plan-detail'),
      import('./pos/accounts/resolve'),
      import('./pos/accounts/types'),
    ]);

    expect(Object.keys(pos).sort()).toEqual([...posRuntimeExports].sort());
    expect(Object.keys(accounts).sort()).toEqual([...accountRuntimeExports].sort());
  });

  it('keeps the exact compiler-resolved public type inventories, including re-exports', () => {
    const posFile = resolve(serviceRoot, 'pos.service.ts');
    const accountsFile = resolve(serviceRoot, 'pos-accounts.service.ts');
    const inventory = publicTypeExports([posFile, accountsFile]);

    expect(inventory.get(posFile)).toEqual([...posTypeExports].sort());
    expect(inventory.get(accountsFile)).toEqual([...accountTypeExports].sort());
  }, 15_000);
});
