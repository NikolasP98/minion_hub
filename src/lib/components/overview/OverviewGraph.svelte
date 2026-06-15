<!--
  OverviewGraph — concentric, sector-partitioned org map.

  Center   = the organization
  Ring 1   = org areas (color-coded)
  Ring 2   = skills / process docs (per area)
  Ring 3   = integrations (branded third-party platforms, Simple Icons logos)
  Ring 4   = agents (gateway agents + provisioned single-function agents)
  Ring 5   = users (avatars; a user assigned to several areas gets one node per
             area, so each sector stays self-contained)

  Built on ECharts `graph` with layout:'none' and pre-computed polar coords.
  Canvas can't resolve CSS variables, so every color here is a real hex.
  Hovering focuses the adjacency; clicking a node focuses its whole area
  sector (others dim) and the camera smoothly pans/zooms to the selection.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import * as echarts from 'echarts';
  import type { OrgArea, VirtualAgent } from '$server/services/org-areas.service';
  import { INTEGRATIONS, integrationIconUrl } from '$lib/types/entities';
  import type { EntityKind } from '$lib/types/entities';
  import { areaIconDataUri } from '$lib/utils/lucide-svg';

  interface AgentLike {
    id: string;
    name?: string | null;
  }
  interface MemberLike {
    id: string;
    displayName?: string | null;
    email?: string | null;
  }

  interface Props {
    org: { id: string; name: string };
    areas: OrgArea[];
    agents: AgentLike[];
    members: MemberLike[];
  }

  let { org, areas, agents, members }: Props = $props();

  type GNode = {
    id: string;
    kind: EntityKind | 'integration';
    label: string;
    color: string;
    areaId: string | null;
    areaName?: string;
    role?: string;
    skills?: string[];
    integrations?: string[];
    x: number;
    y: number;
  };

  // ── Palette (real hex — ECharts renders to canvas, CSS vars don't resolve) ──
  const C = {
    fg: '#fafafa',
    dim: '#a1a1aa',
    faint: '#71717a',
    ring: '#26262b',
    panelBg: 'rgba(14,14,17,0.92)',
    unassigned: '#52525b',
  };

  const RADII = { org: 0, area: 300, skill: 600, integration: 900, agent: 1200, user: 1500 };
  const RING_SEGMENTS = 72;

  const prettify = (key: string) =>
    key.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

  /** DiceBear avatar tinted with the area color so each sector reads as a unit. */
  const avatar = (seed: string, hex: string) =>
    `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${hex.replace('#', '')}&radius=50`;

  // ── Build the layered graph from props ──────────────────────────────────────
  const graph = $derived.by(() => {
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const memberById = new Map(members.map((mm) => [mm.id, mm]));

    const claimedAgents = new Set<string>();
    const claimedUsers = new Set<string>();
    for (const ar of areas) {
      for (const id of ar.agentIds) if (agentById.has(id)) claimedAgents.add(id);
      for (const id of ar.userIds) if (memberById.has(id)) claimedUsers.add(id);
    }
    const looseAgents = agents.filter((a) => !claimedAgents.has(a.id));
    const looseUsers = members.filter((u) => !claimedUsers.has(u.id));

    type AreaBucket = {
      id: string;
      name: string;
      color: string;
      icon: string;
      skills: string[];
      integrations: string[];
      realAgents: AgentLike[];
      virtualAgents: VirtualAgent[];
      users: MemberLike[];
    };
    const buckets: AreaBucket[] = areas.map((ar) => ({
      id: ar.id,
      name: ar.name,
      color: ar.color,
      icon: ar.icon,
      skills: ar.skillKeys,
      integrations: ar.integrationKeys.filter((k) => INTEGRATIONS[k]),
      realAgents: ar.agentIds.map((id) => agentById.get(id)).filter((a): a is AgentLike => !!a),
      virtualAgents: ar.virtualAgents,
      users: ar.userIds.map((id) => memberById.get(id)).filter((u): u is MemberLike => !!u),
    }));
    if (looseAgents.length || looseUsers.length || buckets.length === 0) {
      buckets.push({
        id: '__unassigned__',
        name: 'Unassigned',
        color: C.unassigned,
        icon: 'Boxes',
        skills: [],
        integrations: [],
        realAgents: looseAgents,
        virtualAgents: [],
        users: looseUsers,
      });
    }

    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];
    const meta = new Map<string, GNode>();

    type NodeOpts = {
      symbolSize: number;
      image?: string;
      label?: Record<string, unknown>;
      itemStyle?: Record<string, unknown>;
      silent?: boolean;
    };
    const pushNode = (n: GNode, opts: NodeOpts) => {
      meta.set(n.id, n);
      nodes.push({
        id: n.id,
        name: n.label,
        x: n.x,
        y: n.y,
        fixed: true,
        symbol: opts.image ? `image://${opts.image}` : 'circle',
        symbolSize: opts.symbolSize,
        itemStyle: opts.itemStyle ?? { color: n.color },
        label: opts.label ?? { show: false },
        silent: opts.silent ?? false,
        value: n.kind,
      });
    };
    const at = (r: number, angle: number) => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });

    // Orbit guides: faint circles drawn as closed polylines of invisible nodes,
    // so they live in data coords and pan/zoom with the graph.
    for (const r of [RADII.area, RADII.skill, RADII.integration, RADII.agent, RADII.user]) {
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        const p = at(r, a);
        nodes.push({
          id: `__ring:${r}:${i}`,
          name: '',
          x: p.x,
          y: p.y,
          fixed: true,
          symbolSize: 1,
          itemStyle: { opacity: 0 },
          label: { show: false },
          tooltip: { show: false },
          emphasis: { disabled: true },
          silent: true,
        });
        edges.push({
          source: `__ring:${r}:${i}`,
          target: `__ring:${r}:${(i + 1) % RING_SEGMENTS}`,
          __ring: true,
          lineStyle: { color: C.ring, opacity: 0.8, width: 1, curveness: 0 },
        });
      }
    }

    // Center: org
    pushNode(
      { id: org.id, kind: 'org', label: org.name, color: C.fg, areaId: null, x: 0, y: 0 },
      {
        symbolSize: 76,
        itemStyle: {
          color: '#101013',
          borderColor: C.fg,
          borderWidth: 2,
          shadowBlur: 40,
          shadowColor: 'rgba(250,250,250,0.35)',
        },
        label: {
          show: true,
          position: 'inside',
          color: C.fg,
          fontSize: 10,
          fontWeight: 700,
          width: 64,
          overflow: 'break',
          lineHeight: 12,
        },
      },
    );

    const n = buckets.length;
    const TAU = Math.PI * 2;
    buckets.forEach((b, i) => {
      const center = -Math.PI / 2 + (i / n) * TAU;
      const half = (TAU / n / 2) * 0.82;
      const spread = (count: number, idx: number) =>
        count <= 1 ? center : center - half + (idx / (count - 1)) * (half * 2);
      const areaName = b.name;

      // ring 1: area
      const ap = at(RADII.area, center);
      pushNode(
        { id: b.id, kind: 'area', label: b.name, color: b.color, areaId: b.id, ...ap },
        {
          symbolSize: 54,
          image: areaIconDataUri(b.icon, b.color, shade(b.color, -0.35)),
          itemStyle: {
            shadowBlur: 26,
            shadowColor: hexToRgba(b.color, 0.45),
          },
          label: {
            show: true,
            position: 'bottom',
            distance: 10,
            color: C.fg,
            fontSize: 12,
            fontWeight: 700,
          },
        },
      );
      edges.push({
        source: org.id,
        target: b.id,
        lineStyle: { color: b.color, opacity: 0.5, width: 1.6, curveness: 0 },
      });

      // ring 2: skills
      b.skills.forEach((sk, j) => {
        const id = `skill:${b.id}:${sk}`;
        pushNode(
          {
            id,
            kind: 'skill',
            label: prettify(sk),
            color: b.color,
            areaId: b.id,
            areaName,
            ...at(RADII.skill, spread(b.skills.length, j)),
          },
          {
            symbolSize: 16,
            itemStyle: {
              color: b.color,
              borderColor: shade(b.color, 0.35),
              borderWidth: 1.2,
              shadowBlur: 10,
              shadowColor: hexToRgba(b.color, 0.4),
            },
            label: { show: true, position: 'bottom', distance: 5, color: C.dim, fontSize: 9 },
          },
        );
        edges.push({
          source: b.id,
          target: id,
          lineStyle: { color: b.color, opacity: 0.32, width: 1, curveness: 0 },
        });
      });

      // ring 3: integrations — a solid neutral disc with the brand logo on top.
      // The logo is its OWN image node (not a label): graph symbols always
      // paint, whereas labels get culled by `labelLayout.hideOverlap` at zoom
      // levels where nodes crowd, which would make icons blink out.
      b.integrations.forEach((ik, j) => {
        const def = INTEGRATIONS[ik];
        const id = `integration:${b.id}:${ik}`;
        const iconUrl = integrationIconUrl(ik);
        const pos = at(RADII.integration, spread(b.integrations.length, j));
        // Background disc (silent — clicks/tooltips belong to the icon node).
        pushNode(
          {
            id: `integration-bg:${b.id}:${ik}`,
            kind: 'integration',
            label: def.name,
            color: def.color,
            areaId: b.id,
            areaName,
            ...pos,
          },
          {
            symbolSize: 34,
            itemStyle: {
              color: '#f4f4f5',
              borderColor: def.color,
              borderWidth: 2,
              shadowBlur: 12,
              shadowColor: hexToRgba(def.color, 0.5),
            },
            label: { show: false },
            silent: true,
          },
        );
        // Brand logo on top.
        pushNode(
          { id, kind: 'integration', label: def.name, color: def.color, areaId: b.id, areaName, ...pos },
          {
            symbolSize: 20,
            image: iconUrl ?? undefined,
            label: { show: false },
          },
        );
        // Zero-length invisible tie so the disc stays lit with its logo on hover.
        edges.push({
          source: `integration-bg:${b.id}:${ik}`,
          target: id,
          __tie: true,
          lineStyle: { opacity: 0, width: 0 },
        });
      });

      // skill → integration edges, derived from the agents that use both.
      const skillIntEdges = new Set<string>();
      for (const va of b.virtualAgents) {
        for (const ik of va.integrationKeys) {
          if (!INTEGRATIONS[ik] || !b.integrations.includes(ik)) continue;
          for (const sk of va.skillKeys) {
            if (!b.skills.includes(sk)) continue;
            skillIntEdges.add(`${sk}→${ik}`);
          }
        }
      }
      for (const key of skillIntEdges) {
        const [sk, ik] = key.split('→');
        edges.push({
          source: `skill:${b.id}:${sk}`,
          target: `integration:${b.id}:${ik}`,
          lineStyle: { color: b.color, opacity: 0.28, width: 1, curveness: 0 },
        });
      }

      // ring 4: agents (real gateway agents first, then provisioned ones)
      const agentCount = b.realAgents.length + b.virtualAgents.length;
      b.realAgents.forEach((a, j) => {
        const id = `agent:${b.id}:${a.id}`;
        pushNode(
          {
            id,
            kind: 'agent',
            label: a.name ?? a.id,
            color: b.color,
            areaId: b.id,
            areaName,
            role: 'Server agent',
            ...at(RADII.agent, spread(agentCount, j)),
          },
          {
            symbolSize: 40,
            image: avatar(a.id, b.color),
            label: {
              show: true,
              position: 'bottom',
              distance: 4,
              color: '#e4e4e7',
              fontSize: 10,
              fontWeight: 600,
            },
          },
        );
        edges.push({
          source: b.id,
          target: id,
          lineStyle: { color: b.color, opacity: 0.28, width: 1, curveness: 0 },
        });
      });
      b.virtualAgents.forEach((va, j) => {
        const id = `agent:${b.id}:${va.id}`;
        pushNode(
          {
            id,
            kind: 'agent',
            label: va.name,
            color: b.color,
            areaId: b.id,
            areaName,
            role: va.role,
            skills: va.skillKeys.map(prettify),
            integrations: va.integrationKeys
              .filter((k) => INTEGRATIONS[k])
              .map((k) => INTEGRATIONS[k].name),
            ...at(RADII.agent, spread(agentCount, b.realAgents.length + j)),
          },
          {
            symbolSize: 36,
            image: avatar(va.id, b.color),
            label: { show: true, position: 'bottom', distance: 4, color: C.dim, fontSize: 9.5 },
          },
        );
        const ints = va.integrationKeys.filter(
          (k) => INTEGRATIONS[k] && b.integrations.includes(k),
        );
        if (ints.length) {
          for (const ik of ints) {
            edges.push({
              source: `integration:${b.id}:${ik}`,
              target: id,
              lineStyle: { color: INTEGRATIONS[ik].color, opacity: 0.35, width: 1, curveness: 0 },
            });
          }
        } else {
          // no integration in the chain — link straight from its skills
          for (const sk of va.skillKeys.filter((s) => b.skills.includes(s))) {
            edges.push({
              source: `skill:${b.id}:${sk}`,
              target: id,
              lineStyle: { color: b.color, opacity: 0.28, width: 1, curveness: 0 },
            });
          }
        }
      });

      // ring 5: users — one node per (area, user), so Renzo can sit in every
      // sector he works in. A user is one ring level below the agents, so they
      // tether to the agents they oversee (assignment is area-level, so a user
      // links to every agent in their sector) — never straight to the area,
      // skills or integrations.
      const sectorAgentIds = [
        ...b.realAgents.map((a) => `agent:${b.id}:${a.id}`),
        ...b.virtualAgents.map((va) => `agent:${b.id}:${va.id}`),
      ];
      b.users.forEach((u, j) => {
        const id = `user:${b.id}:${u.id}`;
        pushNode(
          {
            id,
            kind: 'user',
            label: u.displayName ?? u.email ?? 'User',
            color: b.color,
            areaId: b.id,
            areaName,
            role: 'Team member',
            ...at(RADII.user, spread(b.users.length, j)),
          },
          {
            symbolSize: 34,
            image: avatar(u.id, b.color),
            label: { show: true, position: 'bottom', distance: 4, color: C.dim, fontSize: 10 },
          },
        );
        if (sectorAgentIds.length) {
          for (const aId of sectorAgentIds) {
            edges.push({
              source: aId,
              target: id,
              lineStyle: { color: b.color, opacity: 0.2, width: 1, curveness: 0 },
            });
          }
        } else {
          // No agents in the sector — tether to the area so the user isn't orphaned.
          edges.push({
            source: b.id,
            target: id,
            lineStyle: { color: b.color, opacity: 0.2, width: 1, curveness: 0 },
          });
        }
      });
    });

    return { nodes, edges, meta };
  });

  // ── Color helpers ────────────────────────────────────────────────────────────
  function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
  }
  function shade(hex: string, amt: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
    const r = f((v >> 16) & 255);
    const g = f((v >> 8) & 255);
    const bl = f(v & 255);
    return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
  }

  // ── ECharts + camera ─────────────────────────────────────────────────────────
  let canvasEl: HTMLDivElement | undefined = $state();
  let chart: echarts.ECharts | null = null;
  let selected = $state<GNode | null>(null);

  const HOME_VIEW = { center: [0, 0] as [number, number], zoom: 0.46 };
  let view = { center: [...HOME_VIEW.center] as [number, number], zoom: HOME_VIEW.zoom };
  let baseScale = 0; // px per data-unit at zoom=1, measured after first render
  let raf = 0;

  const ZOOM_MIN = 0.12;
  const ZOOM_MAX = 5;
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  // Coalesce rapid pan/zoom updates: mousemove can fire far faster than the
  // chart can repaint, so we keep only the latest view and flush it once per
  // animation frame. Without this, setOption calls backlog and the graph lags
  // seconds behind the cursor.
  let viewRaf = 0;
  let pendingView: { center: [number, number]; zoom: number } | null = null;
  function flushView() {
    viewRaf = 0;
    if (pendingView && chart) {
      chart.setOption({ series: [{ id: 'overview', center: pendingView.center, zoom: pendingView.zoom }] });
      pendingView = null;
    }
  }
  /** Apply a view (center+zoom); painted on the next frame (coalesced). */
  function setView(center: [number, number], zoom: number) {
    view = { center, zoom };
    pendingView = { center, zoom };
    if (!viewRaf) viewRaf = requestAnimationFrame(flushView);
  }

  /** Signed px-per-data-unit for each axis at the current view. */
  function axisScale(): { sx: number; sy: number } {
    if (!chart) return { sx: 1, sy: 1 };
    const p0 = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]) as number[];
    const px = chart.convertToPixel({ seriesIndex: 0 }, [100, 0]) as number[];
    const py = chart.convertToPixel({ seriesIndex: 0 }, [0, 100]) as number[];
    return { sx: (px[0] - p0[0]) / 100, sy: (py[1] - p0[1]) / 100 };
  }

  function measureView(): { center: [number, number]; zoom: number } {
    if (!chart) return view;
    try {
      const w = chart.getWidth();
      const h = chart.getHeight();
      const c = chart.convertFromPixel({ seriesIndex: 0 }, [w / 2, h / 2]) as number[];
      const p0 = chart.convertToPixel({ seriesIndex: 0 }, [0, 0]) as number[];
      const p1 = chart.convertToPixel({ seriesIndex: 0 }, [100, 0]) as number[];
      const scale = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 100;
      if (!baseScale && scale > 0) baseScale = scale / view.zoom;
      const zoom = baseScale > 0 ? scale / baseScale : view.zoom;
      return { center: [c[0], c[1]], zoom };
    } catch {
      return view;
    }
  }

  function animateTo(center: [number, number], zoom: number, ms = 650) {
    if (!chart) return;
    cancelAnimationFrame(raf);
    const from = measureView();
    const start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const k = ease(t);
      view = {
        center: [
          from.center[0] + (center[0] - from.center[0]) * k,
          from.center[1] + (center[1] - from.center[1]) * k,
        ],
        zoom: from.zoom + (zoom - from.zoom) * k,
      };
      chart?.setOption({ series: [{ id: 'overview', center: view.center, zoom: view.zoom }] });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /** Everything in the clicked node's sector stays lit; the rest dims. */
  function focusSetFor(node: GNode | null): Set<string> | null {
    if (!node || node.kind === 'org') return null;
    const ids = new Set<string>([org.id]);
    for (const [id, m] of graph.meta) if (m.areaId === node.areaId) ids.add(id);
    return ids;
  }

  function buildOption(focus: Set<string> | null) {
    const dimNode = (nd: Record<string, unknown>) => {
      const id = nd.id as string;
      if (id.startsWith('__ring')) return nd;
      if (!focus || focus.has(id)) return nd;
      return {
        ...nd,
        itemStyle: { ...(nd.itemStyle as object), opacity: 0.07 },
        label: { ...(nd.label as object), show: false },
      };
    };
    const dimEdge = (e: Record<string, unknown>) => {
      if (e.__ring || e.__tie || !focus) return e;
      const lit = focus.has(e.source as string) && focus.has(e.target as string);
      if (lit) {
        const ls = e.lineStyle as Record<string, unknown>;
        return { ...e, lineStyle: { ...ls, opacity: 0.75, width: 1.6 } };
      }
      return { ...e, lineStyle: { ...(e.lineStyle as object), opacity: 0.03 } };
    };

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: C.panelBg,
        borderColor: 'rgba(255,255,255,0.08)',
        textStyle: { color: C.fg, fontSize: 11 },
        formatter: (p: { dataType?: string; data?: { id?: string } }) => {
          if (p.dataType !== 'node') return '';
          const m = p.data?.id ? graph.meta.get(p.data.id) : null;
          if (!m) return '';
          const sub = m.role ?? m.kind;
          const area = m.areaName ? `<div style="color:${m.color};font-size:10px">${m.areaName}</div>` : '';
          return `<b>${m.label}</b><div style="color:#a1a1aa;font-size:10px;text-transform:capitalize">${sub}</div>${area}`;
        },
      },
      series: [
        {
          id: 'overview',
          type: 'graph',
          layout: 'none',
          // Built-in roam only grabs inside the rendered nodes' bounding box,
          // leaving the canvas corners as dead zones. We drive pan/zoom from
          // custom zrender handlers (see onMount) so it works anywhere.
          roam: false,
          zoom: view.zoom,
          center: view.center,
          labelLayout: { hideOverlap: true },
          emphasis: {
            focus: 'adjacency',
            scale: 1.18,
            label: { show: true },
            lineStyle: { opacity: 0.9, width: 2 },
            itemStyle: { shadowBlur: 22, shadowColor: 'rgba(255,255,255,0.3)' },
          },
          blur: { itemStyle: { opacity: 0.18 }, lineStyle: { opacity: 0.05 } },
          data: graph.nodes.map(dimNode),
          edges: graph.edges.map(dimEdge),
        },
      ],
    };
  }

  onMount(() => {
    if (!canvasEl) return;
    chart = echarts.init(canvasEl);

    // ── Custom pan/zoom across the WHOLE canvas ────────────────────────────
    // zrender root events fire for every pixel (including corners outside the
    // node bounding box, where built-in roam goes dead), so we grab the data
    // point under the cursor on mousedown and keep it pinned there as we drag.
    // `dragMoved` lets the click handlers ignore the release that ends a drag.
    type ZrPoint = { offsetX: number; offsetY: number };
    type ZrWheel = ZrPoint & { wheelDelta: number; event?: Event };
    const zr = chart.getZr();
    let panning = false;
    let dragMoved = false;
    let anchor: [number, number] = [0, 0];
    let sx = 1;
    let sy = 1;

    chart.on('click', (params: echarts.ECElementEvent) => {
      if (dragMoved || params.dataType !== 'node') return;
      const id = (params.data as { id?: string })?.id;
      if (!id || id.startsWith('__ring')) return;
      const m = graph.meta.get(id) ?? null;
      selected = m;
      if (!m) return;
      if (m.kind === 'org') {
        animateTo(HOME_VIEW.center, HOME_VIEW.zoom);
      } else if (m.kind === 'area') {
        // center the sector (midpoint between area and user rings along its axis)
        const ang = Math.atan2(m.y, m.x);
        const r = (RADII.area + RADII.user) / 2;
        animateTo([r * Math.cos(ang), r * Math.sin(ang)], 1.0);
      } else {
        animateTo([m.x, m.y], 1.55);
      }
    });

    zr.on('mousedown', (e: ZrPoint) => {
      panning = true;
      dragMoved = false;
      cancelAnimationFrame(raf);
      const d = chart?.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]) as number[];
      anchor = [d[0], d[1]];
      ({ sx, sy } = axisScale());
    });
    zr.on('mousemove', (e: ZrPoint) => {
      if (!panning || !chart || !sx || !sy) return;
      dragMoved = true;
      const w = chart.getWidth();
      const h = chart.getHeight();
      setView([anchor[0] - (e.offsetX - w / 2) / sx, anchor[1] - (e.offsetY - h / 2) / sy], view.zoom);
    });
    const endPan = () => {
      panning = false;
    };
    zr.on('mouseup', endPan);
    zr.on('globalout', endPan);
    window.addEventListener('mouseup', endPan);

    // Wheel zoom toward the cursor — anywhere on the canvas.
    zr.on('mousewheel', (e: ZrWheel) => {
      if (!chart) return;
      e.event?.preventDefault?.();
      const factor = e.wheelDelta > 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clampZoom(view.zoom * factor);
      if (nextZoom === view.zoom) return;
      const d = chart.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]) as number[];
      const s = axisScale();
      const k = nextZoom / view.zoom;
      const nsx = s.sx * k;
      const nsy = s.sy * k;
      const w = chart.getWidth();
      const h = chart.getHeight();
      setView([d[0] - (e.offsetX - w / 2) / nsx, d[1] - (e.offsetY - h / 2) / nsy], nextZoom);
    });

    // Click on empty canvas → clear focus and glide home (ignore drag-release).
    zr.on('click', (e: { target?: unknown }) => {
      if (dragMoved) return;
      if (!e.target && selected) {
        selected = null;
        animateTo(HOME_VIEW.center, HOME_VIEW.zoom);
      }
    });

    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(canvasEl);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(viewRaf);
      window.removeEventListener('mouseup', endPan);
      ro.disconnect();
      chart?.dispose();
      chart = null;
    };
  });

  $effect(() => {
    if (!chart) return;
    const focus = focusSetFor(selected);
    view = measureView();
    chart.setOption(buildOption(focus), { notMerge: true });
  });
</script>

<div class="relative w-full h-full overview-stage">
  <div bind:this={canvasEl} class="w-full h-full"></div>

  {#if graph.nodes.length <= RING_SEGMENTS * 5 + 1}
    <div class="absolute inset-0 flex items-center justify-center text-center px-8 pointer-events-none">
      <div class="text-muted text-sm">
        No areas yet — create org areas and assign agents to see the map.
      </div>
    </div>
  {/if}

  <!-- Ring legend -->
  <div class="absolute bottom-3 left-3 z-10 flex flex-col gap-1 text-[10px] text-muted bg-bg2/80 backdrop-blur-sm border border-border rounded-lg px-2.5 py-2 pointer-events-none">
    {#each [['Areas', '●'], ['Skills', '◦'], ['Integrations', '◆'], ['Agents', '◉'], ['Users', '◎']] as [name, glyph] (name)}
      <div class="flex items-center gap-1.5"><span class="opacity-60">{glyph}</span><span>{name}</span></div>
    {/each}
  </div>

  {#if selected}
    <div class="absolute bottom-3 right-3 z-10 w-[260px] bg-bg2/95 backdrop-blur-sm border border-border rounded-lg shadow-lg text-[11px] overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2 border-b border-border">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {selected.color}"></span>
          <span class="text-foreground font-medium truncate">{selected.label}</span>
        </div>
        <button type="button" class="text-muted hover:text-foreground cursor-pointer shrink-0 ml-2" onclick={() => (selected = null)}>&times;</button>
      </div>
      <div class="px-3 py-2 flex flex-col gap-1.5">
        <div class="flex items-center gap-1.5">
          <span class="px-1.5 py-0.5 rounded text-[9px] font-medium text-white capitalize" style="background-color: {selected.color}">{selected.kind}</span>
          {#if selected.areaName}<span class="text-muted">{selected.areaName}</span>{/if}
        </div>
        {#if selected.role}<div class="text-muted">{selected.role}</div>{/if}
        {#if selected.skills?.length}
          <div class="flex flex-wrap gap-1">
            {#each selected.skills as sk (sk)}
              <span class="px-1.5 py-0.5 rounded bg-bg1 border border-border text-[9px] text-foreground">{sk}</span>
            {/each}
          </div>
        {/if}
        {#if selected.integrations?.length}
          <div class="flex flex-wrap gap-1">
            {#each selected.integrations as ik (ik)}
              <span class="px-1.5 py-0.5 rounded bg-bg1 border border-border text-[9px] text-muted">{ik}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .overview-stage {
    background:
      radial-gradient(ellipse 70% 60% at 50% 45%, rgba(99, 102, 241, 0.05), transparent 70%),
      radial-gradient(ellipse 100% 100% at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.35));
  }
</style>
