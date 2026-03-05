# Testing Patterns

**Analysis Date:** 2026-03-05

## Test Framework

**Runner:**
- Vitest v4.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect` from `vitest`)

**Run Commands:**
```bash
bun run test              # Run all tests (vitest run)
bun run test:watch        # Watch mode (vitest)
bun run vitest run src/lib/utils/format.test.ts  # Single file
```

## Test File Organization

**Location:**
- Co-located with source files (test file sits next to the module it tests)

**Naming:**
- `{module-name}.test.ts` (e.g., `format.test.ts`, `server.service.test.ts`)

**Structure:**
```
src/lib/utils/format.ts           # Source
src/lib/utils/format.test.ts      # Test
src/server/services/server.service.ts       # Source
src/server/services/server.service.test.ts  # Test
src/server/db/utils.ts            # Source
src/server/db/utils.test.ts       # Test
```

**Existing test files (10 total):**
- `src/lib/utils/format.test.ts` -- formatting utility tests
- `src/lib/utils/text.test.ts` -- text extraction/cleaning tests
- `src/lib/utils/uuid.test.ts` -- UUID generation tests
- `src/server/db/utils.test.ts` -- ID generation and timestamp tests
- `src/server/services/server.service.test.ts` -- server CRUD tests
- `src/server/services/mission.service.test.ts` -- mission CRUD tests
- `src/server/services/task.service.test.ts` -- task CRUD tests
- `src/server/services/bug.service.test.ts` -- bug reporting tests
- `src/server/services/file.service.test.ts` -- file upload/download tests
- `src/server/services/user.service.test.ts` -- user management tests
- `src/server/services/metrics.service.test.ts` -- metrics validation tests
- `src/routes/api/metrics/push/push.test.ts` -- push endpoint contract tests

## Test Setup

**Global setup file:** `src/server/test-utils/setup.ts`

Sets safe environment defaults to prevent accidental connections to real services:
```typescript
process.env.TURSO_DB_URL ??= 'file::memory:';
process.env.TURSO_DB_AUTH_TOKEN ??= '';
process.env.B2_ENDPOINT ??= 'http://localhost:0';
process.env.B2_KEY_ID ??= 'test-key-id';
process.env.B2_APP_KEY ??= 'test-app-key';
process.env.B2_BUCKET_NAME ??= 'test-bucket';
```

**Vitest config (`vitest.config.ts`):**
```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/server/test-utils/setup.ts'],
    alias: {
      '$server': path.resolve('src/server'),
    },
  },
});
```

Note: The `$lib` alias is handled by SvelteKit's generated tsconfig, but `$server` must be explicitly aliased in vitest config.

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { fmtTokens, fmtTimeAgo } from './format';

describe('fmtTokens', () => {
  it('returns "0" for null', () => expect(fmtTokens(null)).toBe('0'));
  it('returns "0" for undefined', () => expect(fmtTokens(undefined)).toBe('0'));
  it('formats thousands with k', () => expect(fmtTokens(2500)).toBe('2.5k'));
});
```

**Patterns:**
- One `describe` block per exported function
- Short, descriptive `it` labels: `'returns "0" for null'`, `'calls db.insert and returns id'`
- For simple assertions, use single-line `it` blocks
- For complex assertions, use multi-line `it` blocks with setup/act/assert
- `beforeEach(() => vi.clearAllMocks())` at module level for service tests

## Mocking

**Framework:** Vitest `vi.mock()` and `vi.fn()`

**Pattern 1: Module-level vi.mock for internal deps (most common):**
```typescript
vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-server-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));
```

**Pattern 2: Typed mock functions for external services:**
```typescript
const mockUploadToB2 = vi.fn<(k: string, b: Buffer | Uint8Array, ct: string) => Promise<void>>();
const mockGetSignedDownloadUrl = vi.fn<(k: string) => Promise<string>>()
  .mockResolvedValue('https://signed-url.example.com/file');

vi.mock('$server/storage/b2', () => ({
  uploadToB2: (k: string, b: Buffer | Uint8Array, ct: string) => mockUploadToB2(k, b, ct),
  getSignedDownloadUrl: (k: string) => mockGetSignedDownloadUrl(k),
}));
```

**Important:** When wrapping mock fns in `vi.mock()` factories, use explicitly typed wrapper signatures instead of `(...args: unknown[]) => mock(...args)`. The latter passes vitest but fails `svelte-check` with "spread argument must have a tuple type".

**Pattern 3: Chainable Drizzle DB mock (`src/server/test-utils/mock-db.ts`):**
```typescript
import { createMockDb } from '$server/test-utils/mock-db';

const { db, resolve } = createMockDb();
const mockServers = [{ id: 's1', name: 'test' }];
resolve(mockServers);
const result = await listServers({ db, tenantId: 't1' });
expect(result).toEqual(mockServers);
```

The `createMockDb()` utility creates a Proxy-based mock that mimics Drizzle's chainable query API:
- `resolve(value)` -- set a single return value for all awaited chains
- `resolveSequence([v1, v2, ...])` -- return different values for sequential DB calls
- Top-level methods (`db.insert`, `db.select`, `db.delete`, `db.update`) are `vi.fn()` spies for assertion

**What to Mock:**
- `$server/db/utils` (newId, nowMs) -- deterministic IDs and timestamps
- `$server/storage/b2` -- external cloud storage
- `$lib/auth` -- authentication provider
- Database client via `createMockDb()` -- avoids real DB connections

**What NOT to Mock:**
- Pure utility functions (format, text, uuid) -- test directly with real implementations
- Type/interface definitions

## Fixtures and Factories

**Test Data:**
```typescript
// Inline test data -- no separate fixtures directory
const mockServers = [{ id: 's1', name: 'test', url: 'http://x', token: 'x', lastConnectedAt: null }];
resolve(mockServers);

// For service tests, TenantContext is always inline:
const ctx = { db, tenantId: 't1' };
```

**Location:**
- Test data is defined inline within test files
- No shared fixtures directory
- The only shared test utility is `src/server/test-utils/mock-db.ts`

## Coverage

**Requirements:** None enforced -- no coverage thresholds configured

**View Coverage:**
```bash
bun run vitest run --coverage  # If @vitest/coverage-v8 is installed (not currently in deps)
```

## Test Types

**Unit Tests (all current tests):**
- Pure function tests: test input/output without any mocking (`format.test.ts`, `text.test.ts`, `uuid.test.ts`, `utils.test.ts`)
- Service layer tests: mock DB and external services, test service function logic (`server.service.test.ts`, `mission.service.test.ts`, etc.)
- Contract validation tests: verify request/response shapes without real HTTP (`push.test.ts`, `metrics.service.test.ts`)

**Integration Tests:**
- Not present. Comments in test files note: "Full integration tests require a running SvelteKit server with Turso."

**E2E Tests:**
- Not present. No Playwright or Cypress configured.

**Component Tests:**
- Not present. No Svelte component test files exist.

## Common Patterns

**Testing null/undefined/edge cases:**
```typescript
it('returns "0" for null', () => expect(fmtTokens(null)).toBe('0'));
it('returns "0" for undefined', () => expect(fmtTokens(undefined)).toBe('0'));
it('returns "0" for 0', () => expect(fmtTokens(0)).toBe('0'));
```
Always test null, undefined, and zero/empty edge cases for utility functions.

**Async Service Testing:**
```typescript
it('calls db.insert and returns id', async () => {
  const { db } = createMockDb();
  const id = await createMission(
    { db, tenantId: 't1' },
    { serverId: 's1', sessionId: 'sess1', title: 'Build landing page' },
  );
  expect(id).toBe('mock-mission-id-00000001');
  expect(db.insert).toHaveBeenCalled();
});
```

**Testing "not found" cases:**
```typescript
it('returns null when not found', async () => {
  const { db, resolve } = createMockDb();
  resolve([]);
  const result = await getMission({ db, tenantId: 't1' }, 'nonexistent');
  expect(result).toBeNull();
});
```

**Testing delete operations:**
```typescript
it('calls db.delete without error', async () => {
  const { db } = createMockDb();
  await deleteMission({ db, tenantId: 't1' }, 'm1');
  expect(db.delete).toHaveBeenCalled();
});
```

**Asserting specific table passed to DB method:**
```typescript
import { user } from '$server/db/schema';

it('calls db.delete on user table', async () => {
  const { db } = createMockDb();
  await deleteUser({ db, tenantId: 't1' }, 'u1');
  expect(db.delete).toHaveBeenCalledWith(user);
});
```

## Writing New Tests

**For a new utility function in `src/lib/utils/`:**
1. Create `src/lib/utils/{name}.test.ts` next to the source file
2. Import from `vitest` and the module under test
3. Test all edge cases (null, undefined, empty, typical, boundary)
4. No mocking needed for pure functions

**For a new server service in `src/server/services/`:**
1. Create `src/server/services/{name}.service.test.ts` next to the source
2. Mock `$server/db/utils` for deterministic IDs/timestamps
3. Mock any external service dependencies with typed `vi.fn()`
4. Use `createMockDb()` from `$server/test-utils/mock-db`
5. Test each CRUD function in its own `describe` block
6. Always include: create returns ID, list returns array, get returns null when not found, delete calls db.delete

**For a new API route contract test:**
1. Create test file alongside the route (e.g., `src/routes/api/.../route-name.test.ts`)
2. Validate request/response shapes without real HTTP -- just test data structures
3. These are lightweight contract tests, not integration tests

---

*Testing analysis: 2026-03-05*
