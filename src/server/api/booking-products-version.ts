import { json } from '@sveltejs/kit';
import {
  BOOKING_PRODUCTS_VERSION,
  BOOKING_PRODUCTS_VERSION_HEADER,
} from '$lib/components/scheduling/booking-product-facets';

/**
 * Spec 126: detail and calendar-window GETs speak ONE wire version. A request without
 * `X-Minion-Booking-Products-Version: 1` (an old tab) gets HTTP 409 `refresh_required` and NO source
 * payload, never a legacy shape filled with `false`/`0`. Presentation compatibility only: it is checked
 * AFTER normal route and module admission and grants nothing.
 */
export function requireProductsVersion(request: Request): Response | null {
  return request.headers.get(BOOKING_PRODUCTS_VERSION_HEADER) === String(BOOKING_PRODUCTS_VERSION)
    ? null
    : json({ error: 'refresh_required' }, { status: 409 });
}
