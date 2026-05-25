<script lang="ts">
	import { onMount } from 'svelte';
	import type { AgentVoiceState, MouthShape } from '$lib/voice/visemeMap';

	/**
	 * Faithful re-creation of OpenHuman's "YellowMascot" — a yellow blob creature
	 * with dot eyes and a viseme-driven mouth. Body path, palette and the
	 * openness/width viseme→path math are reproduced from tinyhumansai/openhuman.
	 * ViewBox 1000×1000. Ported to Svelte 5 from the meeting-agent demo's
	 * OpenHumanMascot.tsx — driven outside the framework (rAF + the shared
	 * `mouth` ref) so it lip-syncs from the live call audio.
	 */
	interface Props {
		/** Shared mouth shape, mutated each frame by the call loop while speaking. */
		mouthRef: MouthShape;
		/** Current agent voice state — drives mouth rest pose, blink, arm, dots. */
		status: AgentVoiceState;
	}

	const { mouthRef, status }: Props = $props();

	// from paths.ts
	const BODY_PATH =
		'M500,240 C700,240 855,420 860,625 C863,770 810,860 700,895 Q500,930 300,895 ' +
		'C190,860 137,770 140,625 C145,420 300,240 500,240 Z';
	const LEFT_LEG =
		'M310,880 C220,895 150,940 175,985 C200,1020 290,1020 360,990 C420,965 430,915 400,890 Z';
	const RIGHT_LEG =
		'M690,880 C780,895 850,940 825,985 C800,1020 710,1020 640,990 C580,965 570,915 600,890 Z';
	const ARM_PATH = 'M800,560 C870,485 955,500 955,575 C955,635 880,650 800,615 Z';

	// from visemes.ts (mouth anchor + resting smile)
	const CX = 520;
	const CY = 590;
	const REST_SMILE_PATH = 'M478,570 Q520,617 562,570 Q520,597 478,570 Z';

	function visemePath(openness: number, width: number): string {
		if (openness < 0.05) return REST_SMILE_PATH;
		const halfW = 26 + width * 40;
		const halfH = 6 + openness * 52;
		const left = CX - halfW;
		const right = CX + halfW;
		const top = CY - halfH;
		const bot = CY + halfH;
		return `M${left},${CY} Q${CX},${top} ${right},${CY} Q${CX},${bot} ${left},${CY} Z`;
	}

	let mouthEl: SVGPathElement;
	let lidL: SVGRectElement;
	let lidR: SVGRectElement;
	let dotsEl: SVGGElement;
	let armEl: SVGGElement;
	let bodyG: SVGGElement;

	onMount(() => {
		let raf = 0;
		let open = 0;
		let width = 0.3;
		let blink = 1;
		let nextBlink = performance.now() / 1000 + 2;
		let closing = false;

		const tick = () => {
			const t = performance.now() / 1000;

			let tOpen: number;
			let tWidth: number;
			if (status === 'speaking') {
				// exaggerate the viseme openness so the mouth reads clearly
				tOpen = Math.min(1, mouthRef.open * 1.5);
				tWidth = Math.min(1, mouthRef.width * 1.15);
			} else if (status === 'thinking') {
				tOpen = 0;
				tWidth = 0.4;
			} else {
				tOpen = 0; // idle/listening rest on the smile
				tWidth = 0.3;
			}
			open += (tOpen - open) * 0.5;
			width += (tWidth - width) * 0.25;
			mouthEl?.setAttribute('d', visemePath(open, width));

			// blink
			if (t > nextBlink && !closing) closing = true;
			if (closing) {
				blink -= 0.08;
				if (blink <= 0) {
					blink = 0;
					closing = false;
					nextBlink = t + 2 + Math.random() * 3;
				}
			} else if (blink < 1) blink = Math.min(1, blink + 0.12);
			const lidH = (1 - blink) * 60;
			lidL?.setAttribute('height', String(lidH));
			lidR?.setAttribute('height', String(lidH));

			// thinking dots
			if (dotsEl) dotsEl.style.opacity = status === 'thinking' ? '1' : '0';

			// wave arm in idle/listening, steady otherwise
			if (armEl) {
				const waving = status === 'idle' || status === 'listening';
				const angle = waving ? -18 + Math.sin(t * 6) * 20 : 6;
				armEl.setAttribute('transform', `rotate(${angle.toFixed(2)} 805 600)`);
			}

			// gentle body breathing (legs + shadow stay grounded)
			if (bodyG) {
				const dy = Math.sin(t * 1.2) * 6;
				const sx = 1 + Math.sin(t * 1.2) * 0.006;
				bodyG.setAttribute('transform', `translate(0 ${dy.toFixed(2)}) scale(${sx.toFixed(4)} 1)`);
				bodyG.style.transformOrigin = '500px 600px';
			}

			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<svg viewBox="0 0 1000 1000" class="avatar-svg" aria-hidden="true">
	<defs>
		<radialGradient id="oh-body" cx="0.36" cy="0.3" r="0.95">
			<stop offset="0%" stop-color="#FBE08A" />
			<stop offset="45%" stop-color="#F7D145" />
			<stop offset="100%" stop-color="#E0A92A" />
		</radialGradient>
	</defs>

	<!-- ground shadow -->
	<ellipse cx="500" cy="975" rx="210" ry="34" fill="rgba(0,0,0,0.28)" />

	<!-- legs behind body (stay grounded) -->
	<path d={LEFT_LEG} fill="#E0A92A" />
	<path d={RIGHT_LEG} fill="#E0A92A" />

	<!-- waving arm -->
	<g bind:this={armEl}>
		<path d={ARM_PATH} fill="#F2C63B" stroke="#C98F1E" stroke-width="6" />
	</g>

	<!-- body + face breathe together -->
	<g bind:this={bodyG}>
		<path d={BODY_PATH} fill="url(#oh-body)" stroke="#C98F1E" stroke-width="6" />
		<!-- eyes (dots) -->
		<circle cx="418" cy="500" r="40" fill="#241a0a" />
		<circle cx="622" cy="500" r="40" fill="#241a0a" />
		<circle cx="432" cy="486" r="13" fill="#fff" opacity="0.9" />
		<circle cx="636" cy="486" r="13" fill="#fff" opacity="0.9" />
		<!-- blink lids — grow down from eye top to cover -->
		<rect bind:this={lidL} x="378" y="460" width="80" height="0" fill="url(#oh-body)" />
		<rect bind:this={lidR} x="582" y="460" width="80" height="0" fill="url(#oh-body)" />
		<!-- mouth (viseme) -->
		<path
			bind:this={mouthEl}
			d={REST_SMILE_PATH}
			fill="#3a1d08"
			stroke="#3a1d08"
			stroke-width="6"
			stroke-linejoin="round"
		/>
	</g>

	<!-- thinking dots -->
	<g bind:this={dotsEl} style="opacity: 0">
		<circle cx="700" cy="300" r="16" fill="#C98F1E" />
		<circle cx="755" cy="265" r="22" fill="#C98F1E" />
		<circle cx="820" cy="220" r="30" fill="#C98F1E" />
	</g>
</svg>

<style>
	.avatar-svg {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
