import * as m from '$lib/paraglide/messages';
import type { DoorKind } from './types';

/** Localized kind label (thunk-style: called at render time, never at module scope). */
export function doorKindLabel(kind: DoorKind | 'book'): string {
  switch (kind) {
    case 'book':
      return m.doors_kind_book();
    case 'form':
      return m.doors_kind_form();
    case 'faq':
      return m.doors_kind_faq();
    case 'offer':
      return m.doors_kind_offer();
  }
}
