import { describe, expect, it } from 'vitest';
import { canonicalPath, localizePath } from '$lib/canonical-path';
import { kitParams } from '../../../tests/fixtures/card-actions/kit-route';
import { recordHref, recordPathSegment } from './record-path';

describe('record identity across native route parsing and locale prefixes', () => {
  it.each([
    'folder/record',
    'literal%2F',
    '%25',
    'two words',
    '東京/ñ',
    'question?#',
    '\\backslash',
  ])('%j survives the page and following API route exactly once', (id) => {
    for (const base of [
      '/agents/builder',
      '/flow-editor/skills',
      '/tools',
      '/flow-editor',
      '/flow-editor/master',
      '/agents/workshop',
    ]) {
      const href = recordHref(base, id);
      expect(href).toBeTypeOf('string');
      for (const locale of ['en', 'es']) {
        const localized = localizePath(href!, locale);
        expect(localized.startsWith(`/${locale}/`)).toBe(true);
        const pageParams = kitParams(`${base}/[id]`, canonicalPath(localized));
        expect(pageParams?.id).toBe(id);
        const apiPath = `/api/builder/skills/${recordPathSegment(pageParams!.id)}/chapter-tools/${recordPathSegment(id)}`;
        expect(kitParams('/api/builder/skills/[id]/chapter-tools/[chapterId]', apiPath)).toEqual({
          id,
          chapterId: id,
        });
      }
    }
  });

  it.each([null, undefined, '', '.', '..', '\uD800'])(
    'invalid %j cannot target a parent route or reach transport',
    (id) => {
      expect(recordHref('/tools', id)).toBeUndefined();
      expect(() => recordPathSegment(id)).toThrow();
    },
  );
});
