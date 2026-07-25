import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCANNER_VERSION = 2;

export type C4Level = 'context' | 'container' | 'component' | 'code';
export type ReconStatus = 'unreviewed' | 'in_review' | 'verified' | 'excluded';
export type ScanStatus = 'current' | 'missing' | 'error';
export type ChangeKind = 'added' | 'modified' | 'missing';

type ArtifactKind = 'directory' | 'file';

export interface ScanOptions {
  root: string;
  dbPath: string;
  now?: string;
  rehash?: boolean;
}

export interface ScanSummary {
  runId: number;
  root: string;
  dbPath: string;
  added: number;
  modified: number;
  unchanged: number;
  missing: number;
  errors: number;
  artifacts: number;
  evidence: {
    symbols: number;
    imports: number;
    httpEndpoints: number;
    gatewayMethods: number;
    gatewayEvents: number;
  };
}

export interface ReconArtifact {
  path: string;
  kind: ArtifactKind;
  c4_level: C4Level;
  parent_path: string | null;
  recon_status: ReconStatus;
  scan_status: ScanStatus;
  content_hash: string | null;
  size_bytes: number | null;
  mtime_ms: number | null;
  last_changed_run_id: number;
}

interface Candidate {
  path: string;
  absolutePath: string;
  kind: ArtifactKind;
  c4Level: C4Level;
  parentPath: string | null;
  repo: string;
  language: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
}

interface ExistingArtifact {
  path: string;
  kind: ArtifactKind;
  c4_level: C4Level;
  c4_source: 'auto' | 'manual';
  parent_path: string | null;
  parent_source: 'auto' | 'manual';
  recon_status: ReconStatus;
  content_hash: string | null;
  size_bytes: number | null;
  mtime_ms: number | null;
  last_changed_run_id: number;
}

interface SourceEvidence {
  symbols: Array<{
    path: string;
    name: string;
    kind: string;
    line: number;
    signature: string;
  }>;
  imports: Array<{
    path: string;
    specifier: string;
    line: number;
    typeOnly: boolean;
  }>;
  httpEndpoints: Array<{
    path: string;
    method: string;
    routeTemplate: string;
    line: number;
  }>;
  gatewayContracts: Array<{
    name: string;
    kind: 'method' | 'event';
    path: string;
    line: number;
  }>;
}

const IGNORED_DIRECTORIES = new Set([
  '.architecture-recon',
  '.claude',
  '.claudian',
  '.dmux',
  '.dmux-hooks',
  '.git',
  '.hermes',
  '.lavish',
  '.next',
  '.nuxt',
  '.obsidian',
  '.planning',
  '.playwright-cli',
  '.playwright-mcp',
  '.prototypes',
  '.serena',
  '.superpowers',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.worktrees',
  'build',
  'coverage',
  'data',
  'dist',
  'node_modules',
  'playwright-report',
  'target',
  'test-results',
]);

const IGNORED_FILES = new Set([
  '.DS_Store',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

const CODE_EXTENSIONS = new Set([
  '.astro',
  '.bash',
  '.c',
  '.cjs',
  '.cpp',
  '.css',
  '.csv',
  '.env.example',
  '.go',
  '.graphql',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.mts',
  '.proto',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

const CODE_FILENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'Dockerfile',
  'Makefile',
  'Procfile',
  'README',
  'README.md',
  'docker-compose.yml',
  'package.json',
  'tsconfig.json',
]);

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/');
}

function isCodeArtifact(name: string): boolean {
  if (IGNORED_FILES.has(name) || (name.startsWith('.env.') && name !== '.env.example'))
    return false;
  if (CODE_FILENAMES.has(name)) return true;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.env.example')) return true;
  return CODE_EXTENSIONS.has(extname(lowerName));
}

function languageFor(name: string): string | null {
  const extension = extname(name).slice(1).toLowerCase();
  if (extension) return extension;
  if (name === 'Dockerfile') return 'dockerfile';
  if (name === 'Makefile') return 'makefile';
  return null;
}

function topLevelSegment(path: string): string {
  return path.split('/')[0] ?? '.';
}

function componentParent(path: string): string {
  const parent = dirname(path);
  return parent === '.' ? '.' : normalizeRelativePath(parent);
}

function classifyDirectory(path: string): C4Level {
  if (path === '.') return 'context';
  return path.includes('/') ? 'component' : 'container';
}

function parentForDirectory(path: string): string | null {
  if (path === '.') return null;
  const parent = componentParent(path);
  return parent === '.' || !path.includes('/') ? '.' : parent;
}

function parentForFile(path: string): string {
  const parent = componentParent(path);
  return parent === '.' ? (topLevelSegment(path) === path ? '.' : topLevelSegment(path)) : parent;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function openReconDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new Database(dbPath, { create: true, strict: true });
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
		CREATE TABLE IF NOT EXISTS recon_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			scanner_version INTEGER NOT NULL,
			root_path TEXT NOT NULL,
			started_at TEXT NOT NULL,
			completed_at TEXT,
			status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
			added_count INTEGER NOT NULL DEFAULT 0,
			modified_count INTEGER NOT NULL DEFAULT 0,
			unchanged_count INTEGER NOT NULL DEFAULT 0,
			missing_count INTEGER NOT NULL DEFAULT 0,
			error_count INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS artifacts (
			path TEXT PRIMARY KEY,
			kind TEXT NOT NULL CHECK (kind IN ('directory', 'file')),
			repository TEXT NOT NULL,
			language TEXT,
			c4_level TEXT NOT NULL CHECK (c4_level IN ('context', 'container', 'component', 'code')),
			c4_source TEXT NOT NULL DEFAULT 'auto' CHECK (c4_source IN ('auto', 'manual')),
			parent_path TEXT REFERENCES artifacts(path) DEFERRABLE INITIALLY DEFERRED,
			parent_source TEXT NOT NULL DEFAULT 'auto' CHECK (parent_source IN ('auto', 'manual')),
			recon_status TEXT NOT NULL DEFAULT 'unreviewed'
				CHECK (recon_status IN ('unreviewed', 'in_review', 'verified', 'excluded')),
			scan_status TEXT NOT NULL DEFAULT 'current' CHECK (scan_status IN ('current', 'missing', 'error')),
			content_hash TEXT,
			size_bytes INTEGER,
			mtime_ms REAL,
			first_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			last_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			last_changed_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			missing_since_run_id INTEGER REFERENCES recon_runs(id),
			scan_error TEXT,
			updated_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS artifacts_c4_parent_idx ON artifacts(c4_level, parent_path);
		CREATE INDEX IF NOT EXISTS artifacts_recon_status_idx ON artifacts(recon_status, scan_status);
		CREATE INDEX IF NOT EXISTS artifacts_last_seen_idx ON artifacts(last_seen_run_id);

		CREATE TABLE IF NOT EXISTS artifact_changes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id INTEGER NOT NULL REFERENCES recon_runs(id) ON DELETE CASCADE,
			path TEXT NOT NULL,
			change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'missing')),
			previous_hash TEXT,
			current_hash TEXT,
			previous_mtime_ms REAL,
			current_mtime_ms REAL,
			detected_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS artifact_changes_run_idx ON artifact_changes(run_id, change_kind);
		CREATE INDEX IF NOT EXISTS artifact_changes_path_idx ON artifact_changes(path, run_id);

		CREATE TABLE IF NOT EXISTS source_symbols (
			path TEXT NOT NULL REFERENCES artifacts(path) ON DELETE CASCADE,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			line INTEGER NOT NULL,
			signature TEXT NOT NULL,
			last_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			PRIMARY KEY (path, kind, name, line)
		);

		CREATE INDEX IF NOT EXISTS source_symbols_name_idx ON source_symbols(name, kind);

		CREATE TABLE IF NOT EXISTS source_imports (
			path TEXT NOT NULL REFERENCES artifacts(path) ON DELETE CASCADE,
			specifier TEXT NOT NULL,
			line INTEGER NOT NULL,
			type_only INTEGER NOT NULL DEFAULT 0 CHECK (type_only IN (0, 1)),
			last_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			PRIMARY KEY (path, specifier, line)
		);

		CREATE INDEX IF NOT EXISTS source_imports_specifier_idx ON source_imports(specifier, path);

		CREATE TABLE IF NOT EXISTS http_endpoints (
			path TEXT NOT NULL REFERENCES artifacts(path) ON DELETE CASCADE,
			method TEXT NOT NULL,
			route_template TEXT NOT NULL,
			line INTEGER NOT NULL,
			last_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			PRIMARY KEY (path, method)
		);

		CREATE INDEX IF NOT EXISTS http_endpoints_route_idx ON http_endpoints(route_template, method);

		CREATE TABLE IF NOT EXISTS gateway_contracts (
			name TEXT NOT NULL,
			contract_kind TEXT NOT NULL CHECK (contract_kind IN ('method', 'event')),
			source_path TEXT NOT NULL REFERENCES artifacts(path) ON DELETE CASCADE,
			line INTEGER NOT NULL,
			last_seen_run_id INTEGER NOT NULL REFERENCES recon_runs(id),
			PRIMARY KEY (name, contract_kind)
		);

		CREATE INDEX IF NOT EXISTS gateway_contracts_kind_idx
			ON gateway_contracts(contract_kind, name);
	`);
  database.exec(`PRAGMA user_version = ${SCANNER_VERSION}`);
  return database;
}

async function collectCandidates(root: string): Promise<Candidate[]> {
  const files: Candidate[] = [];
  const directories = new Set<string>(['.']);

  async function walk(absoluteDirectory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const rootRelativePath =
        relativeDirectory === '.' ? entry.name : `${relativeDirectory}/${entry.name}`;
      const normalizedPath = normalizeRelativePath(rootRelativePath);
      const absolutePath = resolve(absoluteDirectory, entry.name);

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.endsWith('.worktrees')) continue;
        await walk(absolutePath, normalizedPath);
        continue;
      }
      if (!entry.isFile() || !isCodeArtifact(entry.name)) continue;

      const stats = await lstat(absolutePath);
      files.push({
        path: normalizedPath,
        absolutePath,
        kind: 'file',
        c4Level: 'code',
        parentPath: parentForFile(normalizedPath),
        repo: topLevelSegment(normalizedPath),
        language: languageFor(entry.name),
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
      });

      let ancestor = componentParent(normalizedPath);
      while (ancestor !== '.') {
        directories.add(ancestor);
        ancestor = componentParent(ancestor);
      }
      directories.add('.');
    }
  }

  await walk(root, '.');
  const directoryCandidates: Candidate[] = [...directories]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({
      path,
      absolutePath: path === '.' ? root : resolve(root, path),
      kind: 'directory',
      c4Level: classifyDirectory(path),
      parentPath: parentForDirectory(path),
      repo: path === '.' ? '.' : topLevelSegment(path),
      language: null,
      sizeBytes: null,
      mtimeMs: null,
    }));

  return [
    ...directoryCandidates,
    ...files.sort((left, right) => left.path.localeCompare(right.path)),
  ];
}

const SOURCE_EVIDENCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.svelte',
  '.ts',
  '.tsx',
]);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const GATEWAY_CONTRACT_PATH = 'minion/src/gateway/server-core/server-methods-list.ts';

function isDeepReconSource(path: string): boolean {
  return (
    path.startsWith('minion/src/') ||
    path.startsWith('minion/extensions/') ||
    path.startsWith('minion_hub/src/')
  );
}

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function lineForOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? 0) <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

function routeTemplateForSource(path: string): string | null {
  const prefix = 'minion_hub/src/routes';
  if (!path.startsWith(prefix) || !path.endsWith('/+server.ts')) return null;
  const raw = path.slice(prefix.length, -'/+server.ts'.length);
  const withoutGroups = raw
    .split('/')
    .filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) => {
      const optionalRest = /^\[\[\.\.\.(.+)\]\]$/.exec(segment);
      if (optionalRest) return `<${optionalRest[1]}...?>`;
      const rest = /^\[\.\.\.(.+)\]$/.exec(segment);
      if (rest) return `<${rest[1]}...>`;
      const param = /^\[(.+)\]$/.exec(segment);
      return param ? `<${param[1]}>` : segment;
    });
  return `/${withoutGroups.join('/')}`;
}

function extractGatewayArray(
  content: string,
  offsets: number[],
  variableName: 'BASE_METHODS' | 'GATEWAY_EVENTS',
  kind: 'method' | 'event',
): SourceEvidence['gatewayContracts'] {
  const blockPattern = new RegExp(String.raw`export const ${variableName} = \[([\s\S]*?)\n\];`);
  const block = blockPattern.exec(content);
  if (!block || block.index == null) return [];
  const body = block[1] ?? '';
  const bodyOffset = block.index + block[0].indexOf(body);
  const result: SourceEvidence['gatewayContracts'] = [];
  const stringPattern = /["']([^"']+)["']/g;
  for (const match of body.matchAll(stringPattern)) {
    if (match.index == null) continue;
    result.push({
      name: match[1]!,
      kind,
      path: GATEWAY_CONTRACT_PATH,
      line: lineForOffset(offsets, bodyOffset + match.index),
    });
  }
  return result;
}

function extractSourceEvidence(candidates: Candidate[]): SourceEvidence {
  const evidence: SourceEvidence = {
    symbols: [],
    imports: [],
    httpEndpoints: [],
    gatewayContracts: [],
  };

  for (const candidate of candidates) {
    if (
      candidate.kind !== 'file' ||
      !isDeepReconSource(candidate.path) ||
      !SOURCE_EVIDENCE_EXTENSIONS.has(extname(candidate.path).toLowerCase()) ||
      (candidate.sizeBytes ?? 0) > 2_000_000
    ) {
      continue;
    }

    const content = readFileSync(candidate.absolutePath, 'utf8');
    const offsets = lineOffsets(content);
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const symbol =
        /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
          line,
        );
      if (symbol) {
        evidence.symbols.push({
          path: candidate.path,
          kind: symbol[1]!,
          name: symbol[2]!,
          line: index + 1,
          signature: line.trim().slice(0, 500),
        });
      }

      if (candidate.path.endsWith('/+server.ts')) {
        const handler =
          /\bexport\s+(?:const\s+|(?:async\s+)?function\s+)(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.exec(
            line,
          );
        const routeTemplate = routeTemplateForSource(candidate.path);
        if (handler && routeTemplate && HTTP_METHODS.has(handler[1]!)) {
          evidence.httpEndpoints.push({
            path: candidate.path,
            method: handler[1]!,
            routeTemplate,
            line: index + 1,
          });
        }
      }
    });

    const importPattern = /\bimport\s+(type\s+)?(?:[\s\S]{0,500}?\s+from\s+)?["']([^"']+)["']/g;
    for (const match of content.matchAll(importPattern)) {
      if (match.index == null) continue;
      evidence.imports.push({
        path: candidate.path,
        specifier: match[2]!,
        line: lineForOffset(offsets, match.index),
        typeOnly: Boolean(match[1]),
      });
    }

    if (candidate.path === GATEWAY_CONTRACT_PATH) {
      evidence.gatewayContracts.push(
        ...extractGatewayArray(content, offsets, 'BASE_METHODS', 'method'),
        ...extractGatewayArray(content, offsets, 'GATEWAY_EVENTS', 'event'),
      );
    }
  }

  return evidence;
}

function replaceSourceEvidence(database: Database, evidence: SourceEvidence, runId: number): void {
  const insertSymbol = database.query(
    `INSERT INTO source_symbols (path, name, kind, line, signature, last_seen_run_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertImport = database.query(
    `INSERT INTO source_imports (path, specifier, line, type_only, last_seen_run_id)
		 VALUES (?, ?, ?, ?, ?)`,
  );
  const insertEndpoint = database.query(
    `INSERT INTO http_endpoints (path, method, route_template, line, last_seen_run_id)
		 VALUES (?, ?, ?, ?, ?)`,
  );
  const insertContract = database.query(
    `INSERT INTO gateway_contracts (name, contract_kind, source_path, line, last_seen_run_id)
		 VALUES (?, ?, ?, ?, ?)`,
  );

  database.transaction(() => {
    database.exec('DELETE FROM source_symbols');
    database.exec('DELETE FROM source_imports');
    database.exec('DELETE FROM http_endpoints');
    database.exec('DELETE FROM gateway_contracts');
    for (const symbol of evidence.symbols) {
      insertSymbol.run(symbol.path, symbol.name, symbol.kind, symbol.line, symbol.signature, runId);
    }
    for (const dependency of evidence.imports) {
      insertImport.run(
        dependency.path,
        dependency.specifier,
        dependency.line,
        dependency.typeOnly ? 1 : 0,
        runId,
      );
    }
    for (const endpoint of evidence.httpEndpoints) {
      insertEndpoint.run(
        endpoint.path,
        endpoint.method,
        endpoint.routeTemplate,
        endpoint.line,
        runId,
      );
    }
    for (const contract of evidence.gatewayContracts) {
      insertContract.run(contract.name, contract.kind, contract.path, contract.line, runId);
    }
  })();
}

export async function scanArchitecture(options: ScanOptions): Promise<ScanSummary> {
  const root = resolve(options.root);
  const dbPath = resolve(options.dbPath);
  const timestamp = options.now ?? new Date().toISOString();
  await mkdir(dirname(dbPath), { recursive: true });
  const database = openReconDatabase(dbPath);

  const insertRun = database.query<{ id: number }, [number, string, string]>(
    `INSERT INTO recon_runs (scanner_version, root_path, started_at, status)
		 VALUES (?, ?, ?, 'running') RETURNING id`,
  );
  const runId = insertRun.get(SCANNER_VERSION, root, timestamp)?.id;
  if (!runId) throw new Error('Failed to start architecture recon run');

  const summary: ScanSummary = {
    runId,
    root,
    dbPath,
    added: 0,
    modified: 0,
    unchanged: 0,
    missing: 0,
    errors: 0,
    artifacts: 0,
    evidence: {
      symbols: 0,
      imports: 0,
      httpEndpoints: 0,
      gatewayMethods: 0,
      gatewayEvents: 0,
    },
  };

  try {
    const candidates = await collectCandidates(root);
    summary.artifacts = candidates.length;
    const existingQuery = database.query<ExistingArtifact, [string]>(
      `SELECT path, kind, c4_level, c4_source, parent_path, parent_source, recon_status,
				        content_hash, size_bytes, mtime_ms, last_changed_run_id
				 FROM artifacts WHERE path = ?`,
    );
    const insertArtifact = database.query(
      `INSERT INTO artifacts (
				path, kind, repository, language, c4_level, parent_path, content_hash,
				size_bytes, mtime_ms, first_seen_run_id, last_seen_run_id,
				last_changed_run_id, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateArtifact = database.query(
      `UPDATE artifacts SET
					kind = ?, repository = ?, language = ?,
					c4_level = CASE WHEN c4_source = 'manual' THEN c4_level ELSE ? END,
					parent_path = CASE WHEN parent_source = 'manual' THEN parent_path ELSE ? END,
					recon_status = CASE
						WHEN ? = 1 AND recon_status = 'verified' THEN 'in_review'
						ELSE recon_status
					END,
					scan_status = 'current', content_hash = ?, size_bytes = ?, mtime_ms = ?,
					last_seen_run_id = ?, last_changed_run_id = ?, missing_since_run_id = NULL,
				scan_error = NULL, updated_at = ?
			 WHERE path = ?`,
    );
    const insertChange = database.query(
      `INSERT INTO artifact_changes (
				run_id, path, change_kind, previous_hash, current_hash,
				previous_mtime_ms, current_mtime_ms, detected_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    database.transaction(() => {
      for (const candidate of candidates) {
        const existing = existingQuery.get(candidate.path);
        let hash: string | null = null;
        if (candidate.kind === 'file') {
          const metadataMatches =
            !options.rehash &&
            existing?.content_hash &&
            existing.size_bytes === candidate.sizeBytes &&
            existing.mtime_ms === candidate.mtimeMs;
          hash = metadataMatches
            ? existing.content_hash
            : sha256(readFileSync(candidate.absolutePath));
        }

        if (!existing) {
          insertArtifact.run(
            candidate.path,
            candidate.kind,
            candidate.repo,
            candidate.language,
            candidate.c4Level,
            candidate.parentPath,
            hash,
            candidate.sizeBytes,
            candidate.mtimeMs,
            runId,
            runId,
            runId,
            timestamp,
          );
          insertChange.run(
            runId,
            candidate.path,
            'added',
            null,
            hash,
            null,
            candidate.mtimeMs,
            timestamp,
          );
          summary.added += 1;
          continue;
        }

        const changed =
          existing.kind !== candidate.kind ||
          existing.content_hash !== hash ||
          existing.size_bytes !== candidate.sizeBytes;
        updateArtifact.run(
          candidate.kind,
          candidate.repo,
          candidate.language,
          candidate.c4Level,
          candidate.parentPath,
          changed ? 1 : 0,
          hash,
          candidate.sizeBytes,
          candidate.mtimeMs,
          runId,
          changed ? runId : existing.last_changed_run_id,
          timestamp,
          candidate.path,
        );
        if (changed) {
          insertChange.run(
            runId,
            candidate.path,
            'modified',
            existing.content_hash,
            hash,
            existing.mtime_ms,
            candidate.mtimeMs,
            timestamp,
          );
          summary.modified += 1;
        } else {
          summary.unchanged += 1;
        }
      }

      const unseen = database
        .query<{ path: string; content_hash: string | null; mtime_ms: number | null }, [number]>(
          `SELECT path, content_hash, mtime_ms FROM artifacts
					 WHERE last_seen_run_id != ? AND scan_status != 'missing'`,
        )
        .all(runId);
      const markMissing = database.query(
        `UPDATE artifacts SET scan_status = 'missing',
					missing_since_run_id = COALESCE(missing_since_run_id, ?), updated_at = ?
				 WHERE path = ?`,
      );
      for (const artifact of unseen) {
        markMissing.run(runId, timestamp, artifact.path);
        insertChange.run(
          runId,
          artifact.path,
          'missing',
          artifact.content_hash,
          null,
          artifact.mtime_ms,
          null,
          timestamp,
        );
        summary.missing += 1;
      }
    })();

    const sourceEvidence = extractSourceEvidence(candidates);
    replaceSourceEvidence(database, sourceEvidence, runId);
    summary.evidence = {
      symbols: sourceEvidence.symbols.length,
      imports: sourceEvidence.imports.length,
      httpEndpoints: sourceEvidence.httpEndpoints.length,
      gatewayMethods: sourceEvidence.gatewayContracts.filter(
        (contract) => contract.kind === 'method',
      ).length,
      gatewayEvents: sourceEvidence.gatewayContracts.filter((contract) => contract.kind === 'event')
        .length,
    };

    const completedAt = options.now ?? new Date().toISOString();
    database
      .query(
        `UPDATE recon_runs SET completed_at = ?, status = 'completed',
					added_count = ?, modified_count = ?, unchanged_count = ?,
					missing_count = ?, error_count = ?
				 WHERE id = ?`,
      )
      .run(
        completedAt,
        summary.added,
        summary.modified,
        summary.unchanged,
        summary.missing,
        summary.errors,
        runId,
      );
    return summary;
  } catch (error) {
    const failedAt = options.now ?? new Date().toISOString();
    database
      .query(
        `UPDATE recon_runs SET completed_at = ?, status = 'failed', error_count = 1 WHERE id = ?`,
      )
      .run(failedAt, runId);
    throw error;
  } finally {
    database.close();
  }
}

export function markArtifact(
  dbPath: string,
  path: string,
  updates: { status?: ReconStatus; level?: C4Level; parent?: string | null },
): ReconArtifact {
  const database = openReconDatabase(resolve(dbPath));
  try {
    const artifact = database
      .query<{ path: string }, [string]>('SELECT path FROM artifacts WHERE path = ?')
      .get(path);
    if (!artifact) throw new Error(`Unknown artifact: ${path}`);
    if (updates.status) {
      database
        .query('UPDATE artifacts SET recon_status = ? WHERE path = ?')
        .run(updates.status, path);
    }
    if (updates.level) {
      database
        .query(`UPDATE artifacts SET c4_level = ?, c4_source = 'manual' WHERE path = ?`)
        .run(updates.level, path);
    }
    if (updates.parent !== undefined) {
      database
        .query(`UPDATE artifacts SET parent_path = ?, parent_source = 'manual' WHERE path = ?`)
        .run(updates.parent, path);
    }
    return database
      .query<ReconArtifact, [string]>(
        `SELECT path, kind, c4_level, parent_path, recon_status, scan_status,
				        content_hash, size_bytes, mtime_ms
				 FROM artifacts WHERE path = ?`,
      )
      .get(path) as ReconArtifact;
  } finally {
    database.close();
  }
}

export function listReconStatus(dbPath: string): Record<string, unknown> {
  const database = openReconDatabase(resolve(dbPath));
  try {
    const latestRun = database
      .query<Record<string, unknown>, []>('SELECT * FROM recon_runs ORDER BY id DESC LIMIT 1')
      .get();
    const byLevel = database
      .query<{ c4_level: string; count: number }, []>(
        `SELECT c4_level, COUNT(*) AS count FROM artifacts
				 WHERE scan_status = 'current' GROUP BY c4_level ORDER BY c4_level`,
      )
      .all();
    const byReconStatus = database
      .query<{ recon_status: string; count: number }, []>(
        `SELECT recon_status, COUNT(*) AS count FROM artifacts
				 WHERE scan_status = 'current' GROUP BY recon_status ORDER BY recon_status`,
      )
      .all();
    const evidence = {
      symbols:
        database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM source_symbols').get()
          ?.count ?? 0,
      imports:
        database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM source_imports').get()
          ?.count ?? 0,
      httpEndpoints:
        database.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM http_endpoints').get()
          ?.count ?? 0,
      gatewayMethods:
        database
          .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count FROM gateway_contracts WHERE contract_kind = 'method'`,
          )
          .get()?.count ?? 0,
      gatewayEvents:
        database
          .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count FROM gateway_contracts WHERE contract_kind = 'event'`,
          )
          .get()?.count ?? 0,
    };
    return { latestRun: latestRun ?? null, byLevel, byReconStatus, evidence };
  } finally {
    database.close();
  }
}

function argumentValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printHelp(): void {
  console.log(`Architecture recon index

Usage:
  bun scripts/architecture-recon-index.ts scan [--root PATH] [--db PATH] [--rehash]
  bun scripts/architecture-recon-index.ts status [--db PATH]
  bun scripts/architecture-recon-index.ts mark PATH [--status STATUS] [--level LEVEL] [--parent PATH]

Defaults:
  root: meta-repo root (${resolve(import.meta.dir, '../..')})
  db:   ${resolve(import.meta.dir, '../.architecture-recon/index.sqlite')}
`);
}

export async function main(args = Bun.argv.slice(2)): Promise<void> {
  const command = args[0] ?? 'scan';
  const defaultRoot = resolve(import.meta.dir, '../..');
  const defaultDb = resolve(import.meta.dir, '../.architecture-recon/index.sqlite');
  const dbPath = argumentValue(args, '--db') ?? process.env.ARCHITECTURE_RECON_DB ?? defaultDb;

  if (command === 'help' || hasFlag(args, '--help')) {
    printHelp();
    return;
  }
  if (command === 'scan') {
    const summary = await scanArchitecture({
      root: argumentValue(args, '--root') ?? process.env.ARCHITECTURE_RECON_ROOT ?? defaultRoot,
      dbPath,
      rehash: hasFlag(args, '--rehash'),
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(listReconStatus(dbPath), null, 2));
    return;
  }
  if (command === 'mark') {
    const path = args[1];
    if (!path) throw new Error('mark requires an artifact path');
    const status = argumentValue(args, '--status') as ReconStatus | undefined;
    const level = argumentValue(args, '--level') as C4Level | undefined;
    const parent = argumentValue(args, '--parent');
    console.log(JSON.stringify(markArtifact(dbPath, path, { status, level, parent }), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
