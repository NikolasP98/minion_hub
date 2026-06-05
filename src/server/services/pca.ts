/**
 * Dependency-free 2D PCA for projecting high-dimensional embeddings onto a plane
 * for the memory scatter. Uses the Gram-matrix (NxN) formulation + power
 * iteration, which is cheap when N (memories per agent) << D (1536 embedding
 * dims) — we never materialise the DxD covariance.
 *
 * Returns one {x,y} per input vector. For <2 points or degenerate input it falls
 * back to a deterministic layout so the caller always gets usable coordinates.
 */

export interface Point2D {
  x: number;
  y: number;
}

export function pca2d(vectors: number[][]): Point2D[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const d = vectors[0].length;

  // Center the data (subtract per-dimension mean).
  const mean = new Array(d).fill(0);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const x: number[][] = vectors.map((v) => v.map((val, j) => val - mean[j]));

  // Gram matrix G = X Xᵀ  (n x n, symmetric PSD).
  const g: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = i; k < n; k++) {
      let s = 0;
      for (let j = 0; j < d; j++) s += x[i][j] * x[k][j];
      g[i][k] = s;
      g[k][i] = s;
    }
  }

  const { vector: u1, value: l1 } = powerIteration(g, n);
  deflate(g, u1, l1, n);
  const { vector: u2, value: l2 } = powerIteration(g, n);

  // PC scores: score_k(i) = sqrt(λ_k) · u_k(i).
  const s1 = Math.sqrt(Math.max(l1, 0));
  const s2 = Math.sqrt(Math.max(l2, 0));
  return u1.map((_, i) => ({ x: u1[i] * s1, y: u2[i] * s2 }));
}

function powerIteration(g: number[][], n: number, iters = 100): { vector: number[]; value: number } {
  // Deterministic seed (no Math.random) so results are stable across requests.
  let v = new Array(n).fill(0).map((_, i) => Math.sin(i + 1));
  v = normalize(v);
  let value = 0;
  for (let it = 0; it < iters; it++) {
    const gv = matVec(g, v, n);
    const norm = Math.sqrt(gv.reduce((a, b) => a + b * b, 0));
    if (norm < 1e-12) break;
    const next = gv.map((c) => c / norm);
    value = dot(next, matVec(g, next, n));
    if (dot(next, v) > 1 - 1e-10) {
      v = next;
      break;
    }
    v = next;
  }
  return { vector: v, value };
}

function deflate(g: number[][], u: number[], lambda: number, n: number): void {
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) g[i][k] -= lambda * u[i] * u[k];
}

function matVec(m: number[][], v: number[], n: number): number[] {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += m[i][k] * v[k];
    out[i] = s;
  }
  return out;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((c) => c / norm);
}
