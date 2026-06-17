import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { SimNode } from './simulation';
import type { GraphEdge } from './build-graph';

export interface RendererCallbacks {
	onNodeHover?: (id: string | null) => void;
	onNodeClick?: (id: string) => void;
}

export interface Renderer {
	setGraph(nodes: SimNode[], edges: GraphEdge[]): void;
	frame(): void;
	setFocus(ids: Set<string> | null): void;
	animateTo(center: [number, number], zoom: number, ms?: number): void;
	panBy(dxScreen: number, dyScreen: number): void;
	zoomAt(screenX: number, screenY: number, factor: number): void;
	screenToWorld(sx: number, sy: number): [number, number];
	nodeAt(screenX: number, screenY: number): string | null;
	resize(): void;
	destroy(): void;
}

const RING_COLOR = 0x26262b;
const ZOOM_MIN = 0.12;
const ZOOM_MAX = 5;
const LABEL_ZOOM_THRESHOLD = 0.3;
const RADII = [300, 600, 900, 1200, 1500];

const hexNum = (hex: string): number => {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);
	return m ? parseInt(m[1], 16) : 0xffffff;
};

/** Browser-rasterised texture loader — handles remote SVG and data-URI SVG
 *  uniformly, and lets cross-origin failures fall back gracefully. */
function loadTexture(url: string): Promise<Texture | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				resolve(Texture.from(img));
			} catch {
				resolve(null);
			}
		};
		img.onerror = () => resolve(null);
		img.src = url;
	});
}

interface NodeView {
	node: SimNode;
	container: Container;
	bg: Graphics;
	label?: Text;
	displayAlpha: number;
	targetAlpha: number;
	screenX: number;
	screenY: number;
}

export async function createRenderer(
	canvas: HTMLCanvasElement,
	cb: RendererCallbacks = {}
): Promise<Renderer> {
	const app = new Application();
	await app.init({
		canvas,
		antialias: true,
		backgroundAlpha: 0,
		resolution: window.devicePixelRatio || 1,
		autoDensity: true,
		autoStart: false,
		// resizeTo only accepts Window | HTMLElement — canvas.parentElement is HTMLElement | null;
		// fall back to canvas itself (HTMLCanvasElement extends HTMLElement) if no parent.
		resizeTo: (canvas.parentElement ?? canvas) as HTMLElement
	});

	const world = new Container();
	const ringLayer = new Graphics();
	const edgeLayer = new Graphics();
	const nodeLayer = new Container();
	world.addChild(ringLayer, edgeLayer, nodeLayer);
	app.stage.addChild(world);

	// Camera state.
	let camCenter: [number, number] = [0, 0];
	let zoom = 0.46;
	let anim: {
		from: [number, number];
		fromZoom: number;
		to: [number, number];
		toZoom: number;
		start: number;
		ms: number;
	} | null = null;

	let views: NodeView[] = [];
	let edges: GraphEdge[] = [];
	const byId = new Map<string, NodeView>();
	let focus: Set<string> | null = null;

	// CSS pixel dimensions — renderer.width/height are physical pixels with autoDensity.
	const W = () => app.renderer.width / (window.devicePixelRatio || 1);
	const H = () => app.renderer.height / (window.devicePixelRatio || 1);

	function applyCamera() {
		world.scale.set(zoom);
		world.position.set(W() / 2 - camCenter[0] * zoom, H() / 2 - camCenter[1] * zoom);
	}

	function drawRings() {
		ringLayer.clear();
		for (const r of RADII) {
			ringLayer.circle(0, 0, r).stroke({ width: 1, color: RING_COLOR, alpha: 0.8 });
		}
	}

	function buildNodeView(node: SimNode): NodeView {
		const container = new Container();
		const bg = new Graphics();
		container.addChild(bg);
		const size = node.symbolSize;

		if (node.kind === 'org') {
			bg.circle(0, 0, size / 2)
				.fill({ color: 0x101013 })
				.stroke({ width: 2, color: 0xfafafa });
		} else if (node.kind === 'integration') {
			bg.circle(0, 0, size / 2)
				.fill({ color: 0xf4f4f5 })
				.stroke({ width: 2, color: hexNum(node.color) });
		} else {
			bg.circle(0, 0, size / 2).fill({ color: hexNum(node.color) });
		}

		// Sprite image (avatar / area-icon / shared glyph), loaded async.
		if (node.image) {
			const sprite = new Sprite();
			sprite.anchor.set(0.5);
			container.addChild(sprite);
			loadTexture(node.image).then((tex) => {
				if (tex) {
					sprite.texture = tex;
					sprite.width = size;
					sprite.height = size;
				}
			});
		}
		// Integration brand logo overlay.
		if (node.logoImage && node.logoSize) {
			const logo = new Sprite();
			logo.anchor.set(0.5);
			container.addChild(logo);
			loadTexture(node.logoImage).then((tex) => {
				if (tex) {
					logo.texture = tex;
					logo.width = node.logoSize!;
					logo.height = node.logoSize!;
				}
			});
		}

		let label: Text | undefined;
		if (node.showLabel) {
			label = new Text({
				text: node.label,
				style: {
					fill: node.labelColor,
					fontSize: node.labelSize,
					fontWeight: node.kind === 'org' || node.kind === 'area' ? '700' : '400',
					align: 'center',
					wordWrap: true,
					wordWrapWidth: 120
				}
			});
			label.anchor.set(0.5, 0);
			label.position.set(0, size / 2 + 4);
			container.addChild(label);
		}

		nodeLayer.addChild(container);
		return { node, container, bg, label, displayAlpha: 1, targetAlpha: 1, screenX: 0, screenY: 0 };
	}

	function setGraph(nodes: SimNode[], nextEdges: GraphEdge[]) {
		for (const child of nodeLayer.removeChildren()) child.destroy({ children: true, texture: false });
		byId.clear();
		views = nodes.map((nd) => {
			const v = buildNodeView(nd);
			byId.set(nd.id, v);
			return v;
		});
		edges = nextEdges;
		drawRings();
		applyCamera();
	}

	function focusFactor(id: string): number {
		if (!focus) return 1;
		return focus.has(id) ? 1 : 0.07;
	}

	function frame() {
		// Camera tween.
		if (anim) {
			const t = Math.min(1, (performance.now() - anim.start) / anim.ms);
			const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			camCenter = [
				anim.from[0] + (anim.to[0] - anim.from[0]) * k,
				anim.from[1] + (anim.to[1] - anim.from[1]) * k
			];
			zoom = anim.fromZoom + (anim.toZoom - anim.fromZoom) * k;
			if (t >= 1) anim = null;
		}
		applyCamera();

		const showLabels = zoom >= LABEL_ZOOM_THRESHOLD;

		// Nodes: position + alpha lerp + cache screen coords for hit-testing.
		for (const v of views) {
			v.container.position.set(v.node.x, v.node.y);
			v.targetAlpha = focusFactor(v.node.id);
			v.displayAlpha += (v.targetAlpha - v.displayAlpha) * 0.18;
			v.container.alpha = v.displayAlpha;
			if (v.label) v.label.visible = showLabels && (!focus || focus.has(v.node.id));
			v.screenX = v.node.x * zoom + world.position.x;
			v.screenY = v.node.y * zoom + world.position.y;
		}

		// Edges.
		edgeLayer.clear();
		for (const e of edges) {
			const s = byId.get(e.source);
			const tg = byId.get(e.target);
			if (!s || !tg) continue;
			let alpha = e.baseOpacity;
			if (focus) {
				const lit = focus.has(e.source) && focus.has(e.target);
				alpha = lit ? Math.min(0.85, e.baseOpacity + 0.3) : 0.03;
			}
			const col = hexNum(e.color);
			if (e.dashed) {
				drawDashed(edgeLayer, s.node.x, s.node.y, tg.node.x, tg.node.y, e.width, col, alpha);
			} else {
				edgeLayer
					.moveTo(s.node.x, s.node.y)
					.lineTo(tg.node.x, tg.node.y)
					.stroke({ width: e.width, color: col, alpha });
			}
		}

		app.render();
	}

	function drawDashed(
		g: Graphics,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		w: number,
		color: number,
		alpha: number
	) {
		const dash = 8;
		const gap = 6;
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		if (len === 0) return;
		const ux = dx / len;
		const uy = dy / len;
		let d = 0;
		while (d < len) {
			const d2 = Math.min(d + dash, len);
			g.moveTo(x1 + ux * d, y1 + uy * d)
				.lineTo(x1 + ux * d2, y1 + uy * d2)
				.stroke({ width: w, color, alpha });
			d += dash + gap;
		}
	}

	function setFocus(ids: Set<string> | null) {
		focus = ids;
	}

	const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

	function animateTo(to: [number, number], toZoom: number, ms = 650) {
		anim = {
			from: [camCenter[0], camCenter[1]],
			fromZoom: zoom,
			to,
			toZoom: clampZoom(toZoom),
			start: performance.now(),
			ms
		};
	}

	function screenToWorld(sx: number, sy: number): [number, number] {
		return [(sx - world.position.x) / zoom, (sy - world.position.y) / zoom];
	}

	function panBy(dxScreen: number, dyScreen: number) {
		camCenter = [camCenter[0] - dxScreen / zoom, camCenter[1] - dyScreen / zoom];
		anim = null;
	}

	function zoomAt(screenX: number, screenY: number, factor: number) {
		const next = clampZoom(zoom * factor);
		if (next === zoom) return;
		const [wx, wy] = screenToWorld(screenX, screenY);
		zoom = next;
		// Keep the world point under the cursor stationary.
		camCenter = [wx - (screenX - W() / 2) / zoom, wy - (screenY - H() / 2) / zoom];
		anim = null;
	}

	function nodeAt(screenX: number, screenY: number): string | null {
		let best: string | null = null;
		let bestD = Infinity;
		for (const v of views) {
			if (v.node.id.startsWith('__ring')) continue;
			const rad = (v.node.symbolSize / 2) * zoom;
			const d = Math.hypot(screenX - v.screenX, screenY - v.screenY);
			if (d <= rad && d < bestD) {
				bestD = d;
				best = v.node.id;
			}
		}
		return best;
	}

	function resize() {
		app.resize();
		applyCamera();
	}

	function destroy() {
		// v8 API: destroy(rendererDestroyOptions?, stageDestroyOptions?)
		// Pass no args — let Pixi clean up stage children automatically.
		app.destroy();
	}

	// Expose cb for future use (hover/click wiring in Task 4's Svelte shell).
	void cb;

	return {
		setGraph,
		frame,
		setFocus,
		animateTo,
		panBy,
		zoomAt,
		screenToWorld,
		nodeAt,
		resize,
		destroy
	};
}
