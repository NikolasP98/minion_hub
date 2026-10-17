import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from './icon-sizes.mjs';

const withBarrel = `<script lang="ts">
  import { Button, Badge } from '$lib/components/ui';
  import { X } from 'lucide-svelte';
</script>
<X size={16} /><X size={13} /><X size={18} /><X size={10} />`;

test('rewrites scale + off-scale literals and extends the barrel import', () => {
  const r = transform(withBarrel);
  assert.equal(r.replaced, 3);
  assert.equal(r.skipped, 1);
  assert.match(r.source, /import \{ iconSizes, Button, Badge \} from '\$lib\/components\/ui';/);
  assert.match(
    r.source,
    /<X size=\{iconSizes\.md\} \/><X size=\{iconSizes\.sm\} \/><X size=\{18\} \/><X size=\{iconSizes\.xs\} \/>/,
  );
});

test('is idempotent', () => {
  const once = transform(withBarrel).source;
  assert.equal(transform(once).source, once);
  assert.equal(transform(once).replaced, 0);
});

test('adds a new import to the instance script, not the module script', () => {
  const src = `<script module>\n  export const x = 1;\n</script>\n<script lang="ts">\n  import { X } from 'lucide-svelte';\n</script>\n<X size={14} />`;
  const r = transform(src).source;
  assert.match(
    r,
    /<script lang="ts">\n  import \{ iconSizes \} from '\$lib\/components\/ui';\n  import \{ X \}/,
  );
  assert.doesNotMatch(r, /<script module>\n  import \{ iconSizes \}/);
});

test('keeps size={10} where a .t-telemetry surface is rendered', () => {
  const r = transform(
    `<script>\n</script>\n<span class="t-telemetry"><X size={10} /><X size={12} /></span>`,
  );
  assert.equal(r.replaced, 1);
  assert.match(r.source, /size=\{10\}/);
});

test('does not touch a type-only barrel import', () => {
  const r = transform(
    `<script lang="ts">\n  import type { DropdownItem } from '$lib/components/ui';\n</script>\n<X size={12} />`,
  );
  assert.match(r.source, /import type \{ DropdownItem \} from '\$lib\/components\/ui';/);
  assert.match(r.source, /import \{ iconSizes \} from '\$lib\/components\/ui';/);
});
