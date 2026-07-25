import { describe, expect, it } from 'vitest';
import { ARCH_NODES, ARCH_EDGES } from './architecture.service';
import { C4_NODES, C4_RELATIONS } from './architecture-c4.model';

describe('architecture topology', () => {
  it('has unique node ids', () => {
    const ids = ARCH_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every edge references existing nodes and justifies itself', () => {
    const ids = new Set(ARCH_NODES.map((n) => n.id));
    for (const e of ARCH_EDGES) {
      expect(ids.has(e.source), `unknown edge source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `unknown edge target ${e.target}`).toBe(true);
      expect(e.via.length, `edge ${e.source}→${e.target} missing via`).toBeGreaterThan(0);
    }
  });

  it('every node declares an endpoint and a description', () => {
    for (const n of ARCH_NODES) {
      expect(n.endpoints.length, `${n.id} has no endpoints`).toBeGreaterThan(0);
      expect(n.description.length, `${n.id} has no description`).toBeGreaterThan(0);
    }
  });

  it('no orphan nodes (everything is connected to something)', () => {
    const connected = new Set(ARCH_EDGES.flatMap((e) => [e.source, e.target]));
    for (const n of ARCH_NODES) {
      expect(connected.has(n.id), `${n.id} has no connections`).toBe(true);
    }
  });
});

describe('C4 architecture model', () => {
  const levelIndex = new Map([
    ['context', 0],
    ['container', 1],
    ['component', 2],
    ['code', 3],
  ]);

  it('has unique ids and a valid adjacent-level hierarchy', () => {
    const byId = new Map(C4_NODES.map((n) => [n.id, n]));
    expect(byId.size).toBe(C4_NODES.length);

    for (const n of C4_NODES) {
      expect(n.sourceRefs.length, `${n.id} has no source evidence`).toBeGreaterThan(0);
      expect(n.artefacts.length, `${n.id} has no concrete artefacts`).toBeGreaterThan(0);
      if (n.level === 'context') {
        expect(n.parentId, `${n.id} context must be a root`).toBeNull();
        continue;
      }
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      expect(parent, `${n.id} has missing parent ${n.parentId}`).toBeDefined();
      expect(levelIndex.get(parent!.level), `${n.id} skips a C4 level`).toBe(
        levelIndex.get(n.level)! - 1,
      );
    }
  });

  it('keeps every relation attached to known nodes with explicit semantics', () => {
    const ids = new Set(C4_NODES.map((n) => n.id));
    for (const relation of C4_RELATIONS) {
      expect(ids.has(relation.source), `unknown relation source ${relation.source}`).toBe(true);
      expect(ids.has(relation.target), `unknown relation target ${relation.target}`).toBe(true);
      expect(relation.label.length).toBeGreaterThan(0);
      expect(relation.technology.length).toBeGreaterThan(0);
    }
  });

  it('lets every internal system branch reach a concrete code artefact when available', () => {
    const children = new Map<string, string[]>();
    for (const n of C4_NODES) {
      if (!n.parentId) continue;
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
    const reachesCode = (id: string): boolean => {
      const node = C4_NODES.find((n) => n.id === id);
      if (node?.level === 'code') return true;
      return (children.get(id) ?? []).some(reachesCode);
    };
    expect(reachesCode('c4:minion')).toBe(true);
    for (const n of C4_NODES.filter((candidate) => candidate.level === 'container')) {
      expect(reachesCode(n.id), `${n.id} has no code-level evidence`).toBe(true);
    }
  });
});
