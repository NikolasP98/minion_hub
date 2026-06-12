// Minimal word-level diff (LCS) for showing note-polish body changes:
// strikethrough removed words, highlight added words.

export type DiffSeg = { type: 'same' | 'add' | 'del'; text: string };

/** Split into word + whitespace tokens so spacing is preserved in the output. */
function tokenize(s: string): string[] {
	return s.split(/(\s+)/).filter((t) => t.length > 0);
}

export function wordDiff(a: string, b: string): DiffSeg[] {
	const aw = tokenize(a);
	const bw = tokenize(b);
	const n = aw.length;
	const m = bw.length;

	// LCS length table (suffix form).
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const segs: DiffSeg[] = [];
	const push = (type: DiffSeg['type'], text: string) => {
		if (!text) return;
		const last = segs[segs.length - 1];
		if (last && last.type === type) last.text += text;
		else segs.push({ type, text });
	};

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (aw[i] === bw[j]) {
			push('same', aw[i]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			push('del', aw[i]);
			i++;
		} else {
			push('add', bw[j]);
			j++;
		}
	}
	while (i < n) push('del', aw[i++]);
	while (j < m) push('add', bw[j++]);
	return segs;
}
