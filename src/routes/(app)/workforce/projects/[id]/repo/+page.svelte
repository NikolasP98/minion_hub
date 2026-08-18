<script lang="ts">
  // StatusDot is deliberately NOT used here: its palette is the agent-runtime
  // status ramp (running/thinking/idle/aborted). Gate and preview state are a
  // different enum, so they map to the semantic status tokens directly via
  // `.dot` below — one ramp per meaning, per the severity-ramp contract.
  import { Button, Select, EmptyState, Spinner, iconSizes } from '$lib/components/ui';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    GitBranch,
    GitPullRequest,
    GitCommit,
    Link2,
    Unlink,
    Play,
    Square,
    ExternalLink,
    Check,
    MessageSquare,
    AlertCircle,
  } from 'lucide-svelte';
  import { GATE_IDS, type GateId, type GateState } from '$lib/workforce/factory-gates';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The MINION repos, offered as a shortcut — the input stays free-form.
  const SUGGESTED = [
    'minion',
    'minion_hub',
    'minion_site',
    'minion-meta',
    'drone',
    'minion_plugins',
    'paperclip-minion',
    'pixel-agents',
  ];

  let owner = $state('NikolasP98');
  let repoName = $state('');
  let busy = $state(false);
  let formError = $state('');

  let openPr = $state<number | null>(null);
  let decision = $state<'approve' | 'request_changes' | 'comment'>('approve');
  let decisionGate = $state<GateId>('slices');
  let decisionBody = $state('');
  let dispatchAfter = $state(true);

  let previewBranch = $state('');
  let previewExposure = $state<'tailnet' | 'public'>('tailnet');

  const branches = $derived(data.branches?.ok ? data.branches.data : []);
  const pulls = $derived(data.pulls?.ok ? data.pulls.data : []);
  const commits = $derived(data.commits?.ok ? data.commits.data : []);
  const previews = $derived(data.previews.previews);

  const GATE_LABEL: Record<GateId, () => string> = {
    product: () => m.repo_gate_product(),
    architecture: () => m.repo_gate_architecture(),
    'program-design': () => m.repo_gate_programDesign(),
    slices: () => m.repo_gate_slices(),
  };

  function reasonText(reason: string | undefined): string {
    switch (reason) {
      case 'not_configured':
        return m.repo_error_notConfigured();
      case 'not_found':
        return m.repo_error_notFound();
      case 'rate_limited':
        return m.repo_error_rateLimited();
      case 'invalid_repo':
        return m.repo_error_invalidRepo();
      case 'unreachable':
        return m.repo_error_unreachable();
      default:
        return m.repo_error_generic();
    }
  }

  async function post(path: string, method: string, body?: unknown) {
    busy = true;
    formError = '';
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        formError = payload?.message ?? m.repo_error_generic();
        return false;
      }
      return true;
    } catch {
      formError = m.repo_error_generic();
      return false;
    } finally {
      busy = false;
    }
  }

  async function link() {
    const repo = repoName.trim();
    if (!repo) return;
    if (await post(`/api/projects/${data.project.id}/repo`, 'PUT', { owner: owner.trim(), repo })) {
      await invalidate('projects:repo');
    }
  }

  async function unlink() {
    if (await post(`/api/projects/${data.project.id}/repo`, 'DELETE')) {
      await invalidate('projects:repo');
    }
  }

  async function sendReview(prNumber: number) {
    const ok = await post(`/api/projects/${data.project.id}/repo/review`, 'POST', {
      number: prNumber,
      decision,
      body: decisionBody,
      gate: decisionGate,
      dispatch: dispatchAfter,
    });
    if (ok) {
      decisionBody = '';
      openPr = null;
      await invalidate('projects:repo');
    }
  }

  async function startPreview() {
    const branch = previewBranch || data.selectedBranch;
    if (!branch) return;
    if (
      await post(`/api/projects/${data.project.id}/preview`, 'POST', {
        branch,
        exposure: previewExposure,
      })
    ) {
      await invalidate('projects:repo');
    }
  }

  async function stopPreview(previewId: string) {
    if (await post(`/api/projects/${data.project.id}/preview`, 'DELETE', { previewId })) {
      await invalidate('projects:repo');
    }
  }

  function gateTone(state: GateState): 'success' | 'warning' | 'info' | 'idle' {
    return state === 'approved'
      ? 'success'
      : state === 'changes_requested'
        ? 'warning'
        : state === 'in_progress'
          ? 'info'
          : 'idle';
  }

  function previewTone(status: string): 'success' | 'warning' | 'danger' | 'idle' {
    return status === 'running'
      ? 'success'
      : status === 'starting'
        ? 'warning'
        : status === 'failed'
          ? 'danger'
          : 'idle';
  }
</script>

<div class="repo-page">
  <header class="head">
    <div class="head-main">
      <h1 class="t-title">{m.repo_title()}</h1>
      <p class="t-caption sub">{data.project.name}</p>
    </div>
    {#if data.repo}
      <div class="head-actions">
        {#if data.meta?.ok}
          <a
            class="repo-link t-label"
            href={data.meta.data.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {data.meta.data.fullName}
            <ExternalLink size={iconSizes.xs} />
          </a>
        {:else}
          <span class="t-label sub">{data.repo.owner}/{data.repo.repo}</span>
        {/if}
        <Button variant="ghost" size="sm" disabled={busy} onclick={unlink}>
          <Unlink size={iconSizes.sm} />
          {m.repo_unlink()}
        </Button>
      </div>
    {/if}
  </header>

  {#if formError}
    <p class="banner danger t-body" role="alert">
      <AlertCircle size={iconSizes.sm} />
      {formError}
    </p>
  {/if}

  {#if !data.githubConfigured}
    <p class="banner warn t-body">{m.repo_error_notConfigured()}</p>
  {/if}

  {#if !data.repo}
    <!-- ── Unlinked ─────────────────────────────────────────────────────── -->
    <section class="panel">
      <h2 class="t-label section-title">{m.repo_link_title()}</h2>
      <p class="t-caption sub">{m.repo_link_hint()}</p>
      <div class="link-form">
        <label class="field">
          <span class="t-caption sub">{m.repo_link_owner()}</span>
          <input class="inp t-body" bind:value={owner} spellcheck="false" autocomplete="off" />
        </label>
        <label class="field">
          <span class="t-caption sub">{m.repo_link_repo()}</span>
          <input
            class="inp t-body"
            bind:value={repoName}
            spellcheck="false"
            autocomplete="off"
            placeholder="minion_hub"
          />
        </label>
        <Button variant="primary" size="sm" disabled={busy || !repoName.trim()} onclick={link}>
          <Link2 size={iconSizes.sm} />
          {m.repo_link_action()}
        </Button>
      </div>
      <div class="suggest">
        {#each SUGGESTED as name (name)}
          <Button variant="ghost" size="sm" disabled={busy} onclick={() => (repoName = name)}>
            {name}
          </Button>
        {/each}
      </div>
    </section>
  {:else}
    <!-- ── Preview dev server ───────────────────────────────────────────── -->
    <section class="panel">
      <h2 class="t-label section-title">{m.repo_preview_title()}</h2>
      {#if !data.previewRunner}
        <p class="t-caption sub">{m.repo_preview_unavailable()}</p>
      {:else if !data.previews.available}
        <p class="t-caption sub">{reasonText(data.previews.reason ?? undefined)}</p>
      {:else}
        <div class="preview-form">
          <label class="field">
            <span class="t-caption sub">{m.repo_branch()}</span>
            <Select bind:value={previewBranch} size="sm">
              <option value="">{data.selectedBranch ?? m.repo_branch()}</option>
              {#each branches as b (b.name)}
                <option value={b.name}>{b.name}</option>
              {/each}
            </Select>
          </label>
          <label class="field">
            <span class="t-caption sub">{m.repo_preview_exposure()}</span>
            <Select bind:value={previewExposure} size="sm">
              <option value="tailnet">{m.repo_preview_tailnet()}</option>
              <option value="public">{m.repo_preview_public()}</option>
            </Select>
          </label>
          <Button variant="primary" size="sm" disabled={busy} onclick={startPreview}>
            <Play size={iconSizes.sm} />
            {m.repo_preview_start()}
          </Button>
        </div>
        {#if previews.length === 0}
          <p class="t-caption sub">{m.repo_preview_none()}</p>
        {:else}
          <ul class="rows">
            {#each previews as p (p.id)}
              <li class="row">
                <span class="dot {previewTone(p.status)}" aria-hidden="true"></span>
                <span class="t-body grow">
                  {p.branch}
                  <span class="t-caption sub">· {p.exposure}</span>
                </span>
                {#if p.url}
                  <a
                    class="repo-link t-label"
                    href={p.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {m.repo_preview_open()}
                    <ExternalLink size={iconSizes.xs} />
                  </a>
                {:else if p.status === 'starting'}
                  <Spinner size="sm" />
                {/if}
                {#if p.lastError}
                  <span class="t-caption err">{p.lastError}</span>
                {/if}
                <Button variant="ghost" size="sm" disabled={busy} onclick={() => stopPreview(p.id)}>
                  <Square size={iconSizes.sm} />
                  {m.repo_preview_stop()}
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <!-- ── Pull requests + gates ────────────────────────────────────────── -->
    <section class="panel">
      <h2 class="t-label section-title">
        <GitPullRequest size={iconSizes.sm} />
        {m.repo_pulls_title()}
      </h2>
      {#if data.pulls && !data.pulls.ok}
        <p class="t-caption sub">{reasonText(data.pulls.reason)}</p>
      {:else if pulls.length === 0}
        <EmptyState title={m.repo_pulls_empty()} />
      {:else}
        <ul class="rows">
          {#each pulls as pr (pr.number)}
            <li class="pr">
              <div class="pr-head">
                <a class="repo-link t-body" href={pr.url} target="_blank" rel="noreferrer noopener">
                  #{pr.number}
                  {pr.title}
                  <ExternalLink size={iconSizes.xs} />
                </a>
                <span class="t-caption sub">
                  {pr.author ?? '—'} · {pr.headRef} → {pr.baseRef}
                </span>
              </div>
              <div class="ladder">
                {#each GATE_IDS as gid (gid)}
                  <span class="gate {gateTone(pr.ladder.gates[gid])}">
                    <span class="dot {gateTone(pr.ladder.gates[gid])}" aria-hidden="true"></span>
                    <span class="t-caption">{GATE_LABEL[gid]()}</span>
                  </span>
                {/each}
              </div>
              <div class="pr-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => {
                    openPr = openPr === pr.number ? null : pr.number;
                    decisionGate = pr.ladder.currentGate ?? 'slices';
                  }}
                >
                  <MessageSquare size={iconSizes.sm} />
                  {m.repo_review_open()}
                </Button>
              </div>

              {#if openPr === pr.number}
                <div class="decide">
                  <label class="field">
                    <span class="t-caption sub">{m.repo_review_gate()}</span>
                    <Select bind:value={decisionGate} size="sm">
                      {#each GATE_IDS as gid (gid)}
                        <option value={gid}>{GATE_LABEL[gid]()}</option>
                      {/each}
                    </Select>
                  </label>
                  <label class="field">
                    <span class="t-caption sub">{m.repo_review_decision()}</span>
                    <Select bind:value={decision} size="sm">
                      <option value="approve">{m.repo_review_approve()}</option>
                      <option value="request_changes">
                        {m.repo_review_requestChanges()}
                      </option>
                      <option value="comment">{m.repo_review_comment()}</option>
                    </Select>
                  </label>
                  <label class="field wide">
                    <span class="t-caption sub">{m.repo_review_body()}</span>
                    <textarea
                      class="inp area t-body"
                      rows="3"
                      bind:value={decisionBody}
                      maxlength="4000"></textarea>
                  </label>
                  <label class="check t-caption">
                    <input type="checkbox" bind:checked={dispatchAfter} />
                    {m.repo_review_dispatch()}
                  </label>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || (decision !== 'approve' && !decisionBody.trim())}
                    onclick={() => sendReview(pr.number)}
                  >
                    <Check size={iconSizes.sm} />
                    {m.repo_review_submit()}
                  </Button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- ── Branches ─────────────────────────────────────────────────────── -->
    <section class="panel">
      <h2 class="t-label section-title">
        <GitBranch size={iconSizes.sm} />
        {m.repo_branches_title()}
      </h2>
      {#if data.branches && !data.branches.ok}
        <p class="t-caption sub">{reasonText(data.branches.reason)}</p>
      {:else if branches.length === 0}
        <EmptyState title={m.repo_branches_empty()} />
      {:else}
        <ul class="rows">
          {#each branches as b (b.name)}
            <li class="row">
              <GitBranch size={iconSizes.sm} />
              <a class="grow t-body plain" href="?branch={encodeURIComponent(b.name)}">
                {b.name}
              </a>
              {#if previews.some((p) => p.branch === b.name)}
                <span class="t-caption ok">{m.repo_preview_running()}</span>
              {/if}
              <span class="t-caption sub mono">{b.sha.slice(0, 7)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- ── Commits ──────────────────────────────────────────────────────── -->
    <section class="panel">
      <h2 class="t-label section-title">
        <GitCommit size={iconSizes.sm} />
        {m.repo_commits_title()}
        {#if data.selectedBranch}
          <span class="t-caption sub">· {data.selectedBranch}</span>
        {/if}
      </h2>
      {#if data.commits && !data.commits.ok}
        <p class="t-caption sub">{reasonText(data.commits.reason)}</p>
      {:else if commits.length === 0}
        <EmptyState title={m.repo_commits_empty()} />
      {:else}
        <ul class="rows">
          {#each commits as c (c.sha)}
            <li class="row">
              <span class="t-caption sub mono">{c.sha.slice(0, 7)}</span>
              <a class="grow t-body plain" href={c.url} target="_blank" rel="noreferrer noopener">
                {c.message}
              </a>
              <span class="t-caption sub">{c.author ?? '—'}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .repo-page {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-page-gutter);
    overflow-y: auto;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .head-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .sub {
    color: var(--color-text-secondary);
  }
  .err {
    color: var(--color-danger-fg);
  }
  .ok {
    color: var(--color-success-fg);
  }
  .mono {
    font-family: var(--font-mono);
  }

  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
  }
  .banner.danger {
    background: var(--color-danger-surface);
    border-color: var(--color-danger-border);
    color: var(--color-danger-fg);
  }
  .banner.warn {
    background: var(--color-warning-surface);
    border-color: var(--color-warning-border);
    color: var(--color-warning-fg);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-card);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .field.wide {
    grid-column: 1 / -1;
  }
  .inp {
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }
  .inp.area {
    height: auto;
    padding: var(--space-2);
    resize: vertical;
  }

  .link-form,
  .preview-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-control-gap);
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    min-width: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pr {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-card-compact);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }
  .pr-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }
  .pr-actions {
    display: flex;
    gap: var(--space-2);
  }

  .ladder {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    flex: none;
    background: var(--color-text-tertiary);
  }
  .dot.success {
    background: var(--color-success-fg);
  }
  .dot.warning {
    background: var(--color-warning-fg);
  }
  .dot.info {
    background: var(--color-info-fg);
  }
  .dot.danger {
    background: var(--color-danger-fg);
  }

  .gate {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
  }
  .gate.success {
    background: var(--color-success-surface);
    color: var(--color-success-fg);
  }
  .gate.warning {
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
  }
  .gate.info {
    background: var(--color-info-surface);
    color: var(--color-info-fg);
  }

  .decide {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    align-items: end;
    gap: var(--space-control-gap);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-secondary);
  }

  .repo-link,
  .plain {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-primary);
    text-decoration: none;
    min-width: 0;
  }
  .repo-link:hover,
  .plain:hover {
    color: var(--color-accent);
  }
</style>
