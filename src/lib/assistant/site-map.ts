/**
 * The gated page list the assistant may navigate to.
 *
 * Source = ROUTE_DESIGN_MANIFEST (every static screen), described by
 * HUB_ROUTE_MAP where available, filtered per user through `canViewPath`
 * (RBAC + org-kind) — the same gate the sidebar and ⌘K palette use, so the
 * assistant never offers a page the user cannot open.
 */
import { ROUTE_DESIGN_MANIFEST } from '$lib/routes/route-design-manifest';
import { HUB_ROUTE_MAP } from '../../routes/api/gateway/_shared/hub-route-map';
import { FORM_CATALOG } from './catalog';

export interface SitePage {
  path: string;
  title: string;
  description: string;
}

/**
 * EN + ES synonyms per business page, one line each (Peru vocabulary). A `~word`
 * names a module that does NOT exist here — this page is merely the closest one,
 * so it only scores a weak hit and is briefed as "NO MODULE HERE for".
 */
export const PAGE_KEYWORDS: Record<string, string> = {
  '/home': 'chat assistant asistente inicio',
  '/overview': 'dashboard resumen panel metrics kpis',
  '/work': 'tasks tareas pendientes my work',
  '/team':
    'team equipo staff personal people empleados employees vacaciones vacation time off permiso horario availability disponibilidad feriados holidays rooms salas equipment equipos resources ~payroll ~planilla ~nomina ~hr ~rrhh ~humanos ~asistencia',
  '/memberships': 'membresias membresia planes plans suscripciones subscriptions',
  '/support': 'tickets soporte reclamos sla help',
  '/workforce': 'agentes agents proyectos projects ai company',
  '/socials': 'social media redes sociales instagram facebook',
  '/socials/posts': 'publicaciones posts contenido',
  '/socials/campaigns': 'campanas campaigns ~email ~marketing ~newsletter ~mailing',
  '/settings': 'configuracion ajustes preferences',
  '/settings/team':
    'members miembros access acceso shared accounts cuentas compartidas invite invitar',
  '/settings/roles': 'roles permisos permissions rbac',
  '/settings/notifications': 'notificaciones alertas',
  '/settings/appearance': 'theme tema colors colores',
  '/settings/organizations': 'empresa organizacion organizaciones',
  '/settings/backups': 'respaldo copia de seguridad export',
  '/settings/modules': 'modulos features',
  '/users': 'usuarios usuario accounts cuentas',
  '/channels': 'whatsapp telegram integraciones canales',
  '/channels/gmail': 'gmail correo',
  '/notifications': 'notificaciones alertas avisos',
  '/crm': 'crm perfil profile contacto',
  '/crm/customers':
    'clientes cliente pacientes paciente contactos contacts customer supplier suppliers proveedor proveedores',
  '/crm/insights': 'insights analisis sentimiento conversaciones',
  '/finances': 'finanzas finance revenue ingresos kpis ~contabilidad ~accounting ~ledger ~libro',
  '/finances/invoices':
    'comprobantes comprobante boletas boleta facturas factura emitidas sunat ~pagos ~payments ~cobranzas',
  '/finances/purchases':
    'purchases compras compra facturas factura de compra proveedor proveedores supplier invoice bills ~expenses ~gastos ~egresos',
  '/sales': 'ventas orders pedidos historial',
  '/pos/sell': 'pos sale venta vender cobrar caja checkout ticket customer cliente',
  '/pos/catalog':
    'catalog catalogo products productos services servicios bundles bundle paquetes prices precios sellable',
  '/pos/catalog/new': 'product producto service servicio bundle paquete price precio',
  '/pos/appointments': 'checkout cobrar cita',
  '/scheduling': 'citas reservas',
  '/scheduling/bookings': 'appointments appointment citas cita reservas reserva booking',
  '/scheduling/bookings/new': 'appointment cita reserva',
  '/scheduling/calendar': 'calendario agenda',
  '/scheduling/event-types': 'services servicios duration duracion tipos de evento',
  '/scheduling/links': 'enlaces link publico reserva online',
  '/scheduling/reminders': 'recordatorios reminders whatsapp',
  '/stock': 'inventory inventario almacen insumos existencias supplies',
  '/stock/entries':
    'movements movimientos kardex receipts issues transfers adjustments entradas salidas',
  '/stock/entries/new':
    'receipt purchase bought received goods boxes inventory inventario ingreso mercaderia recepcion compra compre recibi cajas insumos almacen supplier proveedor entrada',
  '/stock/items': 'items articulos materials materiales sku insumos',
  '/stock/warehouses': 'almacen almacenes bodega deposito locations ubicaciones',
  '/stock/commitments': 'reserved reservas comprometido pending',
};

/** Pages that host a create form: the word "new" (and add/register/… verbs) counts for them. */
const CREATE_ROUTES = new Set(FORM_CATALOG.map((f) => f.route));

function describe(path: string): string {
  for (const [prefix, desc] of HUB_ROUTE_MAP) {
    if (prefix === '/' ? path === '/' : path === prefix || path === prefix.replace(/\/$/, ''))
      return desc;
  }
  return '';
}

/** Parents that have a `[param]` child in the manifest (e.g. /crm, /stock/entries). */
const DYNAMIC_PARENTS = new Set(
  ROUTE_DESIGN_MANIFEST.filter((r) => r.pattern.includes('['))
    .map((r) => r.pattern.slice(0, r.pattern.indexOf('/[')))
    .filter(Boolean),
);

/** All static screens (no `[param]` segments), unfiltered. */
export function allPages(): SitePage[] {
  return ROUTE_DESIGN_MANIFEST.filter(
    (r) => r.kind === 'screen' && !r.pattern.includes('[') && r.nav !== 'hidden',
  ).map((r) => ({ path: r.pattern, title: r.title(), description: describe(r.pattern) }));
}

/** Pages the current user may open. `canView` is injected so this stays pure/testable. */
export function visiblePages(canView: (path: string) => boolean): SitePage[] {
  return allPages().filter((p) => canView(p.path));
}

/** Resolve a model-proposed path against the visible pages. Exact → prefix → fuzzy suggestions. */
export function resolvePath(
  raw: string,
  pages: SitePage[],
): { ok: true; path: string } | { ok: false; reason: string; suggestions: SitePage[] } {
  const [pathOnly] = raw.split(/[?#]/, 1);
  const path = ('/' + pathOnly.replace(/^\/+/, '').replace(/\/+$/, '')).toLowerCase();
  if (raw.startsWith('//') || raw.includes('\\'))
    return { ok: false, reason: 'off-origin path', suggestions: [] };
  if (pages.some((p) => p.path === path)) return { ok: true, path };
  // Dynamic record pages (/crm/<id>, /stock/entries/<id>) — only where the manifest
  // declares a [param] child under a visible parent; anything else is invented.
  const parent = path.split('/').slice(0, -1).join('/');
  if (
    parent &&
    pages.some((p) => p.path === parent) &&
    DYNAMIC_PARENTS.has(parent) &&
    /^[\w-]+$/.test(path.split('/').pop() ?? '')
  ) {
    return { ok: true, path };
  }
  const suggestions = searchPages(path.replace(/\//g, ' '), pages).slice(0, 5);
  return { ok: false, reason: `no page at ${path}`, suggestions };
}

/** Match weights. A best score below `prefix` is not a confident hit — only a "closest page" hint. */
export const MATCH_SCORE = { exact: 10, prefix: 5, weak: 1 } as const;

/** Token-overlap search over path + title + description + keywords. */
export function searchPages(query: string, pages: SitePage[]): SitePage[] {
  if (tokens(query).length === 0) return pages.slice(0, 20);
  return rankPages(query, pages).map((x) => x.page);
}

/** searchPages with scores: per query token the best hay match (exact > prefix), plus 1 if any `~` keyword hit. */
export function rankPages(query: string, pages: SitePage[]): { page: SitePage; score: number }[] {
  const q = [...new Set(tokens(query))];
  if (q.length === 0) return [];
  return pages
    .map((page) => {
      const path = tokens(page.path);
      const hay = [
        ...path,
        ...tokens(`${page.title} ${page.description} ${PAGE_KEYWORDS[page.path] ?? ''}`),
        ...(CREATE_ROUTES.has(page.path) ? ['new'] : []),
      ];
      let score = 0;
      let weak = 0;
      let hits = 0; // matched non-path tokens — tie-breaker (module names repeat in every path)
      for (const t of q) {
        let best = 0;
        hay.forEach((h, i) => {
          const w = weight(t, h);
          if (w && i >= path.length) hits++;
          best = Math.max(best, w);
        });
        if (best === MATCH_SCORE.weak) weak = 1;
        else score += best;
      }
      return { page, score: score + weak, hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.page.path.length - b.page.path.length)
    .map(({ page, score }) => ({ page, score }));
}

const stem = (t: string) => t.replace(/s$/, '');

function weight(t: string, h: string): number {
  if (h[0] === '~') return stem(h.slice(1)) === stem(t) ? MATCH_SCORE.weak : 0;
  if (stem(h) === stem(t)) return MATCH_SCORE.exact;
  // Inflection only (agendar/agenda, almacenes/almacen): ≥4 shared chars, ≤2 extra — not accounting/account.
  if (
    Math.min(h.length, t.length) >= 4 &&
    Math.abs(h.length - t.length) <= 2 &&
    (h.startsWith(t) || t.startsWith(h))
  )
    return MATCH_SCORE.prefix;
  return 0;
}

const STOP = new Set(
  'a an the i me my to in on of for is it do does how where what can could want need just and or at with this that into from please show tell open go put use make there here be am are we you our el la los las un una unos unas de del al en por para con que como donde es hay mi mis se lo le quiero necesito puedo hacer ver'.split(
    ' ',
  ),
);
/** Create-intent verbs (EN + ES conjugations) fold into the token "new", which create pages carry. */
const CREATE_VERB =
  /^(add|create|register|registr[aoe]r?|record|agreg[aoe]r?|anad[eio]r?|crear|crea|nuev[oa]s?|alta|ingresar|ingresa|book|agendar|agendame|reservar)$/;

/** Lowercase, strip accents (almacén → almacen), drop stop words; keeps a leading `~`. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9~]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (CREATE_VERB.test(t) ? 'new' : t));
}

/** One line per page for the model briefing, keywords trailing in parentheses. */
export function describePages(pages: SitePage[]): string {
  return pages
    .map((p) => {
      const words = (PAGE_KEYWORDS[p.path] ?? '').split(' ').filter(Boolean);
      const strong = words.filter((w) => w[0] !== '~').join(' ');
      const weak = words
        .filter((w) => w[0] === '~')
        .map((w) => w.slice(1))
        .join(' ');
      const tail = words.length
        ? ` (${strong}${weak ? `; NO MODULE HERE for: ${weak} — say that plainly, then offer this page as the nearest` : ''})`
        : '';
      return `${p.path} — ${p.title}${p.description ? `: ${p.description}` : ''}${tail}`;
    })
    .join('\n');
}
