# Consolidate Agent Workspaces to `workspaces/` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate all agent workspace directories on protopi under `~/.minion/workspaces/<agent-id>/` and remove all other naming conventions (`workspace/`, `workspace-<id>`, `workspaces/<old>`).

**Architecture:** Three-layer fix: (1) migrate files on the live server (protopi), (2) update `minion.json` runtime config, (3) fix the fallback path logic in openclaw so newly-created agents default to the correct convention. The minion_hub frontend already uses the correct path in `AddAgentModal.svelte` so no frontend change is needed there.

**Tech Stack:** SSH (protopi), JSON (minion.json), TypeScript (openclaw src/agents/), SvelteKit (minion_hub)

---

## Current State

| Path on protopi | Contents |
|---|---|
| `~/.minion/workspace/` | All 11 agents as subdirs + shared docs (AGENTS.md etc.) + `.git` |
| `~/.minion/workspaces/` | Only `tom_bot` |
| `~/.minion/workspace-giuli_bot/` | MD files + memory only (stale shadow) |
| `~/.minion/workspace-manchas_bot/` | MD files + memory only (stale shadow) |
| `~/.minion/workspace-tom_bot/` | MD files + memory only (stale shadow) |

`minion.json` `defaults.workspace` = `/home/minion/.minion/workspace`
All agents have explicit paths pointing to `workspace/<id>` except tom_bot which correctly points to `workspaces/tom_bot`.

**openclaw fallback logic in `src/agents/agent-scope.ts:193`:**
```ts
return path.join(stateDir, `workspace-${id}`);  // WRONG: creates workspace-giuli_bot etc.
```

**openclaw default in `src/agents/workspace.ts:17-19`:**
```ts
if (profile) return path.join(home, ".minion", `workspace-${profile}`);
return path.join(home, ".minion", "workspace");  // WRONG: singular
```

---

## Task 1: Migrate workspace directories on protopi

**Files:** SSH to `minion@protopi`

**Step 1: Verify current state and create backup**

```bash
ssh minion@protopi "ls ~/.minion/workspaces/"
# Should show: tom_bot
ssh minion@protopi "ls ~/.minion/workspace/"
# Should show: alpha bri_bot carla_bot clawd faces_bot_prd giuli_bot leiva_bot main manchas_bot panik renzo_bot + md files + .git
```

**Step 2: Move all agent subdirs from workspace/ to workspaces/**

```bash
ssh minion@protopi "
cd ~/.minion
for agent in workspace/alpha workspace/bri_bot workspace/carla_bot workspace/clawd workspace/faces_bot_prd workspace/giuli_bot workspace/leiva_bot workspace/main workspace/manchas_bot workspace/panik workspace/renzo_bot; do
  agent_name=\$(basename \$agent)
  echo \"Moving \$agent_name...\"
  mv workspace/\$agent_name workspaces/\$agent_name
done
echo 'Done. workspaces/ now contains:'
ls workspaces/
"
```

Expected output: all 12 agents listed under `workspaces/`.

**Step 3: Handle stale shadow dirs**

These dirs (`workspace-giuli_bot`, `workspace-manchas_bot`, `workspace-tom_bot`) only contain MD files and a `memory/` dir. Compare with the real workspace to avoid losing anything:

```bash
ssh minion@protopi "
echo '=== workspace-giuli_bot extra files ==='
diff -r ~/.minion/workspace-giuli_bot ~/.minion/workspaces/giuli_bot --brief 2>/dev/null | grep 'Only in.*workspace-giuli'
echo '=== workspace-manchas_bot extra files ==='
diff -r ~/.minion/workspace-manchas_bot ~/.minion/workspaces/manchas_bot --brief 2>/dev/null | grep 'Only in.*workspace-manchas'
echo '=== workspace-tom_bot extra files ==='
diff -r ~/.minion/workspace-tom_bot ~/.minion/workspaces/tom_bot --brief 2>/dev/null | grep 'Only in.*workspace-tom'
"
```

If diff shows unique files in the shadow dirs, copy them over first. Then remove:

```bash
ssh minion@protopi "
rm -rf ~/.minion/workspace-giuli_bot
rm -rf ~/.minion/workspace-manchas_bot
rm -rf ~/.minion/workspace-tom_bot
echo 'Shadow dirs removed.'
"
```

**Step 4: Verify workspaces/ is complete**

```bash
ssh minion@protopi "ls ~/.minion/workspaces/"
# Expected: alpha bri_bot carla_bot clawd faces_bot_prd giuli_bot leiva_bot main manchas_bot panik renzo_bot tom_bot
```

---

## Task 2: Update minion.json on protopi

**Files:** `/home/minion/.minion/minion.json` on protopi

**Step 1: Update defaults.workspace and all per-agent workspace paths**

```bash
ssh minion@protopi "
python3 << 'EOF'
import json, re

with open('/home/minion/.minion/minion.json') as f:
    content = f.read()

# Replace all /workspace/<agent> paths with /workspaces/<agent>
content = re.sub(
    r'/home/minion/\.minion/workspace/([^\"]+)',
    r'/home/minion/.minion/workspaces/\1',
    content
)
# Replace default workspace (singular, no trailing agent)
content = content.replace(
    '\"workspace\": \"/home/minion/.minion/workspace\"',
    '\"workspace\": \"/home/minion/.minion/workspaces\"'
)

with open('/home/minion/.minion/minion.json', 'w') as f:
    f.write(content)

print('Done. Verifying...')
EOF
grep -n 'workspace' /home/minion/.minion/minion.json
"
```

**Step 2: Verify no old paths remain**

```bash
ssh minion@protopi "grep 'workspace[^s]' /home/minion/.minion/minion.json | grep -v 'workspace-state'"
# Should return empty (no results)
```

---

## Task 3: Fix openclaw fallback workspace path logic

**Files:**
- Modify: `src/agents/workspace.ts` (lines 10-22)
- Modify: `src/agents/agent-scope.ts` (line 193)

### workspace.ts

**Step 1: Read current function**

```bash
sed -n '10,22p' /home/nikolas/Documents/CODE/AI/openclaw/src/agents/workspace.ts
```

**Step 2: Update `resolveDefaultAgentWorkspaceDir` to use `workspaces/` convention**

Change from:
```ts
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.MINION_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".minion", `workspace-${profile}`);
  }
  return path.join(home, ".minion", "workspace");
}
```

Change to:
```ts
export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = resolveRequiredHomeDir(env, homedir);
  return path.join(home, ".minion", "workspaces");
}
```

> **Why:** The profile-based naming (`workspace-${profile}`) was the old convention. Going forward all workspaces live under `workspaces/` and individual agents get their own subdir. The `MINION_PROFILE` logic is replaced by per-agent subdirectories.

### agent-scope.ts

**Step 3: Read the fallback line**

```bash
sed -n '185,195p' /home/nikolas/Documents/CODE/AI/openclaw/src/agents/agent-scope.ts
```

**Step 4: Update fallback from `workspace-${id}` to `workspaces/${id}`**

In `resolveAgentWorkspaceDir()` around line 193, change:
```ts
return path.join(stateDir, `workspace-${id}`);
```
to:
```ts
return path.join(stateDir, "workspaces", id);
```

**Step 5: Type-check**

```bash
cd /home/nikolas/Documents/CODE/AI/openclaw && bun run check 2>&1 | head -30
```

Expected: no new type errors.

**Step 6: Run workspace-related tests**

```bash
cd /home/nikolas/Documents/CODE/AI/openclaw && bun run test -- --grep workspace 2>&1 | tail -20
```

**Step 7: Commit**

```bash
cd /home/nikolas/Documents/CODE/AI/openclaw
git add src/agents/workspace.ts src/agents/agent-scope.ts
git commit -m "fix: consolidate workspaces to workspaces/<agent-id> convention

Removes workspace-<profile> and workspace/ (singular) fallback paths.
All agent workspaces now live under ~/.minion/workspaces/<agent-id>/.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Confirm minion_hub frontend already correct

**Files:** `src/lib/components/AddAgentModal.svelte` (read-only verification)

**Step 1: Verify correct path is already used**

```bash
grep -n 'workspaces\|workspace' /home/nikolas/Documents/CODE/AI/minion_hub/src/lib/components/AddAgentModal.svelte
```

Expected:
- Line ~35: `workspacePath` derived as `.../workspaces/${name}` (already correct — plural)
- Line ~163: `workspace = .../workspaces/${name.trim()}` (already correct)

No changes needed if confirmed.

---

## Task 5: Restart gateway on protopi and verify

**Step 1: Restart the openclaw gateway service**

```bash
ssh minion@protopi "sudo systemctl restart openclaw 2>/dev/null || pm2 restart all 2>/dev/null || echo 'Check service manager'"
```

If neither systemctl nor pm2 works, find the process:
```bash
ssh minion@protopi "ps aux | grep -E 'minion|openclaw|gateway' | grep -v grep"
```

**Step 2: Verify workspace paths are resolved correctly**

```bash
ssh minion@protopi "ls ~/.minion/workspaces/"
# Should show all 12 agents
```

**Step 3: Check gateway logs for workspace errors**

```bash
ssh minion@protopi "journalctl -u openclaw -n 50 2>/dev/null || pm2 logs --lines 50 2>/dev/null"
```

**Step 4: Verify in minion_hub UI**
- Open minion_hub in browser
- Check that panik, giuli_bot, and other agents show as connected/active
- Open agent settings for any agent and verify workspace path shows `workspaces/<agent>`

---

## Notes

- `workspace/` (singular) will still exist on disk after migration with only the shared `.git`, `.minion`, and root MD files (AGENTS.md, SOUL.md, etc.). It can be archived or removed once confident nothing reads from it.
- The panik workspace is large (has skills, DOCS, node_modules, etc.) — moving with `mv` is atomic since it stays on the same filesystem.
- `workspace/` has a `.git` tracking the shared workspace as a monorepo. After migration, if agents no longer use this shared repo, it can be cleaned up separately.
