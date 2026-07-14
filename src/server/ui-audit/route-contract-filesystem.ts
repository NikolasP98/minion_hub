import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type {
  ComponentContractSnapshot,
  NavReference,
  RedirectSourceContract,
} from '$lib/routes/route-design-validation';
import type { ComponentDesignMeta } from '$lib/routes/component-design-registry';
import type { RedirectDesignMeta } from '$lib/routes/route-design-manifest';

const PAGE_ENTRY_FILES = new Set([
  '+page.svelte',
  '+page.ts',
  '+page.js',
  '+page.server.ts',
  '+page.server.js',
]);

function walkFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function routePattern(routesDirectory: string, directory: string): string {
  const segments = relative(routesDirectory, directory)
    .split(sep)
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

export interface FilesystemPageEndpoint {
  pattern: string;
  directory: string;
  sourceFiles: readonly string[];
}

export function discoverPageEndpoints(projectRoot: string): FilesystemPageEndpoint[] {
  const routesDirectory = join(projectRoot, 'src', 'routes');
  const byDirectory = new Map<string, string[]>();
  for (const file of walkFiles(routesDirectory)) {
    if (!PAGE_ENTRY_FILES.has(basename(file))) continue;
    const directory = file.slice(0, -(basename(file).length + 1));
    const files = byDirectory.get(directory) ?? [];
    files.push(file);
    byDirectory.set(directory, files);
  }
  return [...byDirectory.entries()]
    .map(([directory, sourceFiles]) => ({
      pattern: routePattern(routesDirectory, directory),
      directory,
      sourceFiles: sourceFiles.sort(),
    }))
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
}

export function discoverRedirectSources(
  projectRoot: string,
  redirects: readonly RedirectDesignMeta[],
): RedirectSourceContract[] {
  const endpointByPattern = new Map(
    discoverPageEndpoints(projectRoot).map((endpoint) => [endpoint.pattern, endpoint]),
  );
  return redirects.flatMap((redirect) => {
    const endpoint = endpointByPattern.get(redirect.pattern);
    if (!endpoint) return [];
    const sourceFiles = endpoint.sourceFiles.filter((file) => /\.[jt]s$/.test(file));
    return [
      {
        pattern: redirect.pattern,
        sourceFiles: sourceFiles.map((file) => relative(projectRoot, file)),
        source: sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n'),
      },
    ];
  });
}

function localSourcePath(projectRoot: string, exportPath: string): string | undefined {
  if (!exportPath.startsWith('$lib/')) return undefined;
  return join(projectRoot, 'src', 'lib', exportPath.slice('$lib/'.length));
}

function packageName(exportPath: string): string | undefined {
  return exportPath.startsWith('@') ? exportPath.split('#', 1)[0] : undefined;
}

function packageDeclarationSnapshot(
  projectRoot: string,
  name: string,
): { index: string; declarations: string } | undefined {
  const packageRoot = join(projectRoot, 'node_modules', ...name.split('/'));
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return undefined;
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    types?: string;
  };
  const indexPath = join(packageRoot, packageJson.types ?? 'dist/index.d.ts');
  if (!existsSync(indexPath)) return undefined;
  const declarationRoot = join(packageRoot, 'dist');
  const declarationFiles = existsSync(declarationRoot)
    ? walkFiles(declarationRoot)
        .filter((file) => file.endsWith('.d.ts'))
        .sort()
    : [indexPath];
  return {
    index: readFileSync(indexPath, 'utf8'),
    declarations: declarationFiles
      .map((file) => `// ${relative(packageRoot, file)}\n${readFileSync(file, 'utf8')}`)
      .join('\n'),
  };
}

export function buildComponentContractSnapshot(
  projectRoot: string,
  registry: readonly ComponentDesignMeta[],
): ComponentContractSnapshot {
  const sourceText: Record<string, string> = {};
  const packageIndexes: Record<string, string> = {};
  const sourcePaths = new Set<string>();
  const packageNames = new Set<string>();

  for (const entry of registry) {
    sourcePaths.add(entry.exportPath);
    const pkg = packageName(entry.exportPath);
    if (pkg) packageNames.add(pkg);
    for (const contract of Object.values(entry.sourceContract?.variantTypes ?? {})) {
      if (contract.sourcePath) sourcePaths.add(contract.sourcePath);
    }
  }

  for (const name of packageNames) {
    const snapshot = packageDeclarationSnapshot(projectRoot, name);
    if (!snapshot) continue;
    packageIndexes[name] = snapshot.index;
    for (const entry of registry) {
      if (packageName(entry.exportPath) === name)
        sourceText[entry.exportPath] = snapshot.declarations;
    }
  }
  for (const exportPath of sourcePaths) {
    const path = localSourcePath(projectRoot, exportPath);
    if (path && existsSync(path)) sourceText[exportPath] = readFileSync(path, 'utf8');
  }
  return { sourceText, packageIndexes };
}

function isNavContractFile(projectRoot: string, file: string): boolean {
  const local = relative(projectRoot, file).split(sep).join('/');
  if (local === 'src/lib/nav/routes.ts' || local === 'src/lib/components/layout/sections.ts') {
    return true;
  }
  if (!local.startsWith('src/lib/components/')) return false;
  return /Nav[^/]*\.svelte$/.test(local) || /\/(Sidebar|Topbar|ProfileMenu)\.svelte$/.test(local);
}

export function discoverNavReferences(projectRoot: string): NavReference[] {
  const files = walkFiles(join(projectRoot, 'src', 'lib')).filter((file) =>
    isNavContractFile(projectRoot, file),
  );
  const output: NavReference[] = [];
  const patterns = [
    /\b(?:href|path)\s*:\s*(['"])(\/[^'"\n]*)\1/g,
    /\bhref\s*=\s*(['"])(\/[^'"\n]*)\1/g,
  ];
  for (const file of files.sort()) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        output.push({ sourceFile: relative(projectRoot, file), href: match[2] });
      }
    }
    for (const match of source.matchAll(/\b(?:href|path)\s*:\s*`(\/[^`\n]*)`/g)) {
      output.push({
        sourceFile: relative(projectRoot, file),
        href: match[1].replace(/\$\{[^}]+\}/g, '[dynamic]'),
      });
    }
  }
  return output.sort(
    (left, right) =>
      left.sourceFile.localeCompare(right.sourceFile) || left.href.localeCompare(right.href),
  );
}
