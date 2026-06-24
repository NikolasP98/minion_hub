<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { ArrowLeft, FileText, Check, AlertTriangle, Ban, ExternalLink } from 'lucide-svelte';
	import { PageHeader, Button } from '$lib/components/ui';
	import { createBackNav } from '$lib/nav/back-nav.svelte';

	let { data }: { data: PageData } = $props();
	const back = createBackNav('/finances/invoices', m.fin_back_to_invoices);
	const inv = $derived(data.invoice);
	const items = $derived(data.items);
	const payments = $derived(data.payments);
	const crmContactId = $derived(data.crmContactId);

	const isVoid = $derived(inv.status === 'void');

	function fmtDate(d: Date | null) {
		if (!d) return '—';
		return new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
	}
	// Money: PEN renders with an "S/" prefix; any other currency falls back to its code.
	const sym = $derived(inv.currency && inv.currency !== 'PEN' ? `${inv.currency} ` : 'S/ ');
	function money(v: string | number | null) {
		if (v == null || v === '') return '—';
		const n = Number(v);
		if (!Number.isFinite(n)) return '—';
		return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
	}
	// Skip empty/zero optional fields (don't reserve layout for noise).
	const hasVal = (v: unknown) => v != null && v !== '' && v !== '—';
	const numVal = (v: string | null) => {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	};

	// ── Paid vs owed (the emotional core) ───────────────────────────────────────
	// Money received = sum of non-void payments. Outstanding = total − received.
	const total = $derived(numVal(inv.total));
	const paid = $derived(payments.reduce((s, p) => s + (p.status === 'void' ? 0 : numVal(p.amount)), 0));
	const outstanding = $derived(total - paid);
	type PayState = 'full' | 'partial' | 'unpaid';
	const payState = $derived<PayState>(outstanding <= 0.005 ? 'full' : paid > 0.005 ? 'partial' : 'unpaid');
	// Flag when the stored status disagrees with the money math (stale flag guard).
	const statusMismatch = $derived(
		!isVoid &&
			((payState === 'full' && inv.status != null && inv.status !== 'paid') ||
				(payState !== 'full' && inv.status === 'paid')),
	);

	const subtotalMeaningful = $derived(hasVal(inv.subtotal) && numVal(inv.subtotal) !== total);
	const discountNonZero = $derived(numVal(inv.discount) > 0);
	const taxNonZero = $derived(numVal(inv.tax) > 0);
	// Distinct payment methods (secondary info, surfaced in the meta-row).
	const methods = $derived([...new Set(payments.map((p) => p.method).filter(hasVal))] as string[]);
	const hasMeta = $derived(
		methods.length > 0 ||
			hasVal(inv.clientDocNumber) ||
			subtotalMeaningful ||
			taxNonZero ||
			discountNonZero ||
			hasVal(inv.note),
	);
</script>

<svelte:head><title>{m.fin_invoice_detail_title()} {inv.number ?? inv.documentId ?? ''}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader
		title={`${m.fin_invoice_detail_title()} ${inv.number ?? inv.documentId ?? inv.id}`}
		subtitle={m.fin_invoice_detail_subtitle()}
	>
		{#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-4xl">
		<Button variant="outline" size="sm" onclick={back.go} class="self-start">
			<ArrowLeft size={14} />
			{back.label}
		</Button>

		{#if isVoid}
			<div class="void-banner">
				<Ban size={16} />
				<span>{m.fin_inv_void_banner()}</span>
			</div>
		{/if}

		<div class="content" class:voided={isVoid}>
			<!-- One continuous invoice "document": hero head + item/payment sections
			     joined by hairline dividers (no inner borders/radii/seams). -->
			<div class="doc">
			<!-- Hero band: identity + total on the left, payment reconciliation on the
			     right. Secondary fields fold into a separated strip at the bottom. -->
			<section class="hero">
				<div class="hero-top">
					<div class="hero-main">
						<span class="eyebrow">{m.fin_inv_eyebrow({ number: inv.number ?? inv.documentId ?? '—' })}</span>
						<div class="total" class:struck={isVoid}>
							<span class="total-sym">{sym.trim()}</span>
							<span class="total-num">{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
						</div>
						{#if crmContactId}
							<a class="client client-link" href={`/crm/${crmContactId}`}>
								{inv.clientName ?? '—'}<ExternalLink size={13} class="client-ico" />
							</a>
						{:else}
							<span class="client">{inv.clientName ?? '—'}</span>
						{/if}
						<span class="trust">
							{#if inv.seller}
								{m.fin_inv_issued_by({ date: fmtDate(inv.issuedAt), seller: inv.seller })}
							{:else}
								{m.fin_inv_issued_on({ date: fmtDate(inv.issuedAt) })}
							{/if}
						</span>
					</div>

					<!-- Payment state IS the status here — no separate status pill (it just
					     repeated "Paid"). Void is signalled by the banner + struck total. -->
					{#if !isVoid}
						<div class="hero-aside">
							{#if payState === 'full'}
								<div class="pay-badge full">
									<Check size={15} />
									<span class="pay-title">{m.fin_inv_paid_in_full()}</span>
									<span class="pay-sub">{m.fin_inv_received({ amount: money(paid) })}</span>
								</div>
							{:else if payState === 'partial'}
								<div class="pay-badge partial">
									<AlertTriangle size={14} />
									<span class="pay-title">{m.fin_inv_owed({ amount: money(outstanding) })}</span>
									<span class="pay-sub">{m.fin_inv_paid_of_total({ paid: money(paid), total: money(total) })}</span>
								</div>
							{:else}
								<div class="pay-badge unpaid">
									<AlertTriangle size={14} />
									<span class="pay-title">{m.fin_inv_unpaid_owed({ amount: money(total) })}</span>
								</div>
							{/if}
							{#if statusMismatch}
								<span class="mismatch"><AlertTriangle size={11} /> {m.fin_inv_status_mismatch()}</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Secondary fields (empty/zero skipped), separated from the hero head. -->
				{#if hasMeta}
					<div class="meta">
						{#if methods.length}
							<div class="meta-item"><span class="meta-l">{m.fin_inv_method()}</span><span class="meta-v capitalize">{methods.join(', ')}</span></div>
						{/if}
						{#if hasVal(inv.clientDocNumber)}
							<div class="meta-item"><span class="meta-l">{m.fin_col_dni()}</span><span class="meta-v dim">{inv.clientDocNumber}</span></div>
						{/if}
						{#if subtotalMeaningful}
							<div class="meta-item"><span class="meta-l">{m.fin_col_subtotal()}</span><span class="meta-v">{money(inv.subtotal)}</span></div>
						{/if}
						{#if taxNonZero}
							<div class="meta-item"><span class="meta-l">{m.fin_col_tax()}</span><span class="meta-v">{money(inv.tax)}</span></div>
						{/if}
						{#if discountNonZero}
							<div class="meta-item discount"><span class="meta-l">{m.fin_col_discount()}</span><span class="meta-v">{money(inv.discount)}</span></div>
						{/if}
						{#if hasVal(inv.note)}
							<div class="meta-item"><span class="meta-l">{m.fin_col_note()}</span><span class="meta-v note">{inv.note}</span></div>
						{/if}
					</div>
				{/if}
			</section>

			<!-- Items -->
			{#if items.length > 0}
				<section class="doc-sec">
					<header class="panel-h">{m.fin_invoice_items()}</header>
					<table class="w-full text-sm border-collapse">
						<thead>
							<tr class="text-left t-caption border-b border-[var(--hairline)]">
								<th class="px-3 py-2 font-medium">{m.fin_col_description()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_qty()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_unit_price()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_discount()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_total()}</th>
							</tr>
						</thead>
						<tbody>
							{#each items as it (it.id)}
								<tr class="border-b border-[var(--hairline)]">
									<td class="px-3 py-2">{it.description ?? it.code ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums">{it.quantity ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums">{money(it.unitPrice)}</td>
									<td class="px-3 py-2 text-right tabular-nums">{numVal(it.discount) > 0 ? money(it.discount) : ''}</td>
									<td class="px-3 py-2 text-right tabular-nums font-semibold">{money(it.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

			<!-- Payments -->
			{#if payments.length > 0}
				<section class="doc-sec">
					<header class="panel-h">{m.fin_invoice_payments()}</header>
					<table class="w-full text-sm border-collapse">
						<thead>
							<tr class="text-left t-caption border-b border-[var(--hairline)]">
								<th class="px-3 py-2 font-medium">{m.fin_col_paid_at()}</th>
								<th class="px-3 py-2 font-medium">{m.fin_col_method()}</th>
								<th class="px-3 py-2 font-medium text-right">{m.fin_col_amount()}</th>
								<th class="px-3 py-2 font-medium">{m.fin_col_status()}</th>
							</tr>
						</thead>
						<tbody>
							{#each payments as p (p.id)}
								<tr class="border-b border-[var(--hairline)]" class:void-row={p.status === 'void'}>
									<td class="px-3 py-2 t-caption">{fmtDate(p.paidAt)}</td>
									<td class="px-3 py-2 capitalize">{p.method ?? '—'}</td>
									<td class="px-3 py-2 text-right tabular-nums font-medium">{money(p.amount)}</td>
									<td class="px-3 py-2"><span class="status-pill sm" data-status={p.status ?? ''}>{p.status ?? '—'}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if payState === 'full'}
						<div class="received">{m.fin_inv_received_caption({ amount: money(paid) })}</div>
					{/if}
				</section>
			{/if}
			</div>

			{#if hasVal(inv.documentId)}
				<div class="doc-foot">{m.fin_inv_doc({ id: inv.documentId ?? '' })}</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.void-banner {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.6rem 0.9rem; border-radius: var(--radius-md);
		border: 1px solid var(--color-destructive, #ef4444);
		background: color-mix(in srgb, var(--color-destructive, #ef4444) 12%, transparent);
		color: var(--color-destructive, #ef4444);
		font-weight: 700; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.02em;
	}
	/* Void: the banner + struck total carry the signal; keep the rest readable. */
	.content.voided { opacity: 0.82; }

	/* The invoice document — one bordered card; inner sections divided by hairlines. */
	.doc {
		border: 1px solid var(--hairline); border-radius: var(--radius-lg);
		background: var(--color-card); overflow: hidden;
	}

	/* Hero = the document's head section (no own border/radius — part of .doc). */
	.hero {
		display: flex; flex-direction: column; padding: 1.4rem 1.5rem;
	}
	.hero-top {
		display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1.5rem;
	}
	.hero-main { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
	.eyebrow { font-size: 0.72rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted-foreground); }
	.total { display: flex; align-items: baseline; gap: 0.3rem; line-height: 1; }
	.total-sym { font-size: 1.5rem; font-weight: 500; color: var(--color-muted-foreground); }
	.total-num { font-size: 3rem; font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; }
	.total.struck { text-decoration: line-through; }
	.total.struck .total-num, .total.struck .total-sym { color: var(--color-muted-foreground); }
	.client { font-size: 1.125rem; font-weight: 600; color: var(--color-foreground); margin-top: 0.15rem; }
	.client-link { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--color-accent); width: fit-content; }
	.client-link:hover { text-decoration: underline; }
	:global(.client-link .client-ico) { opacity: 0.6; }
	.trust { font-size: 0.875rem; color: var(--color-muted-foreground); }

	.hero-aside { display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; }
	.pay-badge { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; padding: 0.5rem 0.75rem; border-radius: var(--radius-md); text-align: right; }
	.pay-badge :global(svg) { margin-bottom: 0.1rem; }
	.pay-title { font-weight: 700; font-size: 1.05rem; font-variant-numeric: tabular-nums; }
	.pay-sub { font-size: 0.8125rem; opacity: 0.85; font-variant-numeric: tabular-nums; }
	.pay-badge.full { color: var(--color-success, #22c55e); background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent); }
	.pay-badge.partial { color: var(--color-warning, #f59e0b); background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent); }
	.pay-badge.unpaid { color: var(--color-destructive, #ef4444); background: color-mix(in srgb, var(--color-destructive, #ef4444) 13%, transparent); }
	.mismatch { display: inline-flex; align-items: center; gap: 0.2rem; font-size: 0.6875rem; color: var(--color-warning, #f59e0b); }

	/* Meta strip — folded into the hero card, separated by a hairline. */
	.meta {
		display: flex; flex-wrap: wrap; gap: 0.75rem 2rem;
		margin-top: 1.1rem; padding-top: 1.1rem; border-top: 1px solid var(--hairline);
	}
	.meta-item { display: flex; flex-direction: column; gap: 0.05rem; }
	.meta-l { font-size: 0.7rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); }
	.meta-v { font-size: 0.875rem; color: var(--color-foreground); font-variant-numeric: tabular-nums; }
	.meta-v.dim { color: var(--color-muted-foreground); }
	.meta-v.note { font-style: italic; color: var(--color-muted-foreground); }
	.meta-item.discount { padding: 0.05rem 0.5rem; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent); }
	.meta-item.discount .meta-l, .meta-item.discount .meta-v { color: var(--color-warning, #f59e0b); font-weight: 600; }

	/* Document sections (items, payments) — divided from the section above by a
	   full-width hairline; no own border/radius/background (one continuous doc). */
	.doc-sec { border-top: 1px solid var(--hairline); padding: 1rem 1.5rem; overflow-x: auto; }
	/* Align table edges to the section padding (1.5rem) — same gutter as the hero. */
	.doc-sec :global(th:first-child), .doc-sec :global(td:first-child) { padding-left: 0; }
	.doc-sec :global(th:last-child), .doc-sec :global(td:last-child) { padding-right: 0; }
	.panel-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.6rem; }
	.void-row { text-decoration: line-through; color: var(--color-muted-foreground); }
	.received { margin-top: 0.6rem; font-size: 0.8125rem; font-weight: 600; color: var(--color-success, #22c55e); }
	.doc-foot { font-size: 0.6875rem; color: var(--color-muted-foreground); padding: 0 0.25rem; margin-top: 0.6rem; }

	/* Status pill */
	.status-pill {
		display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
		font-size: 0.8rem; font-weight: 600; text-transform: capitalize;
		background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
		color: var(--color-muted-foreground);
	}
	.status-pill.sm { font-size: 0.72rem; padding: 0.05rem 0.45rem; font-weight: 500; }
	.status-pill[data-status='paid'] { background: color-mix(in srgb, var(--color-success, #22c55e) 15%, transparent); color: var(--color-success, #22c55e); }
	.status-pill[data-status='partial'] { background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent); color: var(--color-warning, #f59e0b); }
	.status-pill[data-status='void'] { background: color-mix(in srgb, var(--color-destructive, #ef4444) 12%, transparent); color: var(--color-destructive, #ef4444); }
</style>
