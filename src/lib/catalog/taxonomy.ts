/**
 * Catalog taxonomy — the two axes FACES actually sells along.
 *
 * An aesthetic-medicine catalog is a matrix: TREATMENT ZONE (what body part is
 * addressed) × LINE (which insumo/filler product is used). The 81-row
 * fin_products catalog encodes both in free text ("Malar - Saypha Volume Plus")
 * and neither in a column, so grouping was impossible. This module is the one
 * place that turns a name (+ its stock mapping) into the two slugs.
 *
 * Storage (NO migration — both columns already exist):
 *   fin_products.category         → coarse KIND (Relleno | Toxina | …)
 *   fin_products.metadata.zone    → zone slug
 *   fin_products.metadata.line    → line slug
 *   fin_products.metadata.taxonomySource → 'mapped' | 'inferred' | 'manual'
 *
 * `line` is GROUND TRUTH whenever a stk_consumption row exists (34/81 rows) —
 * the insumo the sale actually burns beats anything parsed from a name. Only
 * the rest is inferred, and inferred rows are marked so a human can audit them.
 *
 * Labels are DATA, not UI chrome: they're Spanish clinical vocabulary stored
 * and displayed as-is, exactly like the pre-existing `category` values the POS
 * already renders raw as filter chips. Paraglide covers the UI chrome around
 * them (the group-by selector, the "unclassified" bucket), not the vocabulary.
 */

export type ZoneSlug =
  | 'labios'
  | 'ojeras'
  | 'menton'
  | 'malar'
  | 'surcos'
  | 'marioneta'
  | 'nariz'
  | 'mandibula'
  | 'frente'
  | 'entrecejo'
  | 'masetero'
  | 'sonrisa-gingival'
  | 'rostro'
  | 'cuerpo'
  | 'intima'
  /**
   * Zone is chosen at SALE time, not encoded in the product: "Toxina 1 Zona",
   * "Toxina 2 Zonas", "BOTOX 1 zona". Distinct from 'ninguna' on purpose — a
   * per-zone toxin sale is very much zonal, we just don't know which zone until
   * the ticket exists, so lumping it into "no zone" would understate every
   * zone's real volume in any by-zone report.
   */
  | 'variable'
  /** Genuinely not a body treatment: a deposit, a payment-method fee. */
  | 'ninguna';

export type LineSlug =
  | 'opera-i'
  | 'opera-ii'
  | 'opera-iii'
  | 'opera-iv'
  | 'opera-corp'
  | 'opera'
  | 'saypha-filler'
  | 'saypha-volume'
  | 'saypha-volume-plus'
  | 'saypha'
  | 'mifill'
  | 'toxina'
  | 'nctf'
  | 'hialuronidasa'
  | 'ac-desoxicolico'
  | 'bioestimulador'
  | 'cosmetico'
  | 'prenda'
  /**
   * Clinical service whose insumo is NOT recorded anywhere — no stk_consumption
   * row and no brand word in the name. Deliberately distinct from 'ninguno'
   * (genuinely insumo-free, like a deposit): this bucket is the actionable
   * worklist of rows a human still has to classify, and collapsing the two
   * would hide it inside the fee bucket.
   */
  | 'por-definir'
  | 'ninguno';

/** Coarse kind — what lands in `fin_products.category`. */
export type CategoryName =
  | 'Relleno'
  | 'Toxina'
  | 'Bioestimulación'
  | 'Mesoterapia'
  | 'Lipólisis'
  | 'Corrección'
  | 'Cosmético'
  | 'Prenda'
  | 'Cargo'
  | 'Paquete'
  | 'Por clasificar';

export const ZONE_LABELS: Record<ZoneSlug, string> = {
  labios: 'Labios',
  ojeras: 'Ojeras',
  menton: 'Mentón',
  malar: 'Malar / Pómulo',
  surcos: 'Surcos nasogenianos',
  marioneta: 'Líneas de marioneta',
  nariz: 'Nariz',
  mandibula: 'Contorno mandibular',
  frente: 'Frente',
  entrecejo: 'Entrecejo',
  masetero: 'Masetero',
  'sonrisa-gingival': 'Sonrisa gingival',
  rostro: 'Rostro completo',
  cuerpo: 'Cuerpo',
  intima: 'Zona íntima',
  variable: 'Zona variable (se elige en la venta)',
  ninguna: 'Sin zona',
};

export const LINE_LABELS: Record<LineSlug, string> = {
  'opera-i': 'Opera I',
  'opera-ii': 'Opera II',
  'opera-iii': 'Opera III',
  'opera-iv': 'Opera IV',
  'opera-corp': 'Opera Corporal',
  opera: 'Opera (sin generación)',
  'saypha-filler': 'Saypha Filler',
  'saypha-volume': 'Saypha Volume',
  'saypha-volume-plus': 'Saypha Volume Plus',
  saypha: 'Saypha (sin variante)',
  mifill: 'MIFILL',
  toxina: 'Toxina botulínica',
  nctf: 'NCTF',
  hialuronidasa: 'Hialuronidasa',
  'ac-desoxicolico': 'Ácido desoxicólico',
  bioestimulador: 'Bioestimulador de colágeno',
  cosmetico: 'Cosmético',
  prenda: 'Prenda',
  'por-definir': 'Insumo por definir',
  ninguno: 'Sin insumo',
};

/** Display order for group headers / kanban columns — most-sold zones first,
 *  then the long tail, then the two non-clinical buckets. */
export const ZONE_ORDER: ZoneSlug[] = [
  'labios',
  'ojeras',
  'nariz',
  'menton',
  'malar',
  'surcos',
  'marioneta',
  'mandibula',
  'masetero',
  'frente',
  'entrecejo',
  'sonrisa-gingival',
  'rostro',
  'cuerpo',
  'intima',
  'variable',
  'ninguna',
];

export const LINE_ORDER: LineSlug[] = [
  'opera-i',
  'opera-ii',
  'opera-iii',
  'opera-iv',
  'opera-corp',
  'opera',
  'saypha-filler',
  'saypha-volume',
  'saypha-volume-plus',
  'saypha',
  'mifill',
  'toxina',
  'nctf',
  'bioestimulador',
  'ac-desoxicolico',
  'hialuronidasa',
  'cosmetico',
  'prenda',
  'por-definir',
  'ninguno',
];

// ── Zone inference ─────────────────────────────────────────────────────────
// Ordered: a specific zone must win over the catch-all "facial/rostro" tail,
// so "Afinamiento Facial" lands on rostro but "Botox Ojeras" lands on ojeras.
const ZONE_PATTERNS: Array<[RegExp, ZoneSlug]> = [
  [/ojeras/i, 'ojeras'],
  [/labios|\blips?\b|lip\s|labial/i, 'labios'],
  [/ment[oó]n/i, 'menton'],
  [/malar|p[oó]mulo/i, 'malar'],
  [/surco/i, 'surcos'],
  [/marioneta/i, 'marioneta'],
  [/rino|rhino|nariz|nasal/i, 'nariz'],
  [/contorno\s*mandibular|jawline|mandibul/i, 'mandibula'],
  [/masetero/i, 'masetero'],
  [/entrecejo|glabela/i, 'entrecejo'],
  [/frente|frontal/i, 'frente'],
  [/sonrisa\s*gingival|gingival/i, 'sonrisa-gingival'],
  [/faja|slim\s*body|corporal|\bcorp\b|abdomen/i, 'cuerpo'],
  [/[ií]ntimo|[ií]ntima|eudaria/i, 'intima'],
  [/full\s*face|rostro|facial|\bcara\b/i, 'rostro'],
];

/**
 * Names that carry no zone word at all but are unambiguous clinically. Keyed by
 * product CODE, checked before the regexes — cheaper and more honest than
 * bending a regex until "NCTF-3s" means "face".
 */
const ZONE_BY_CODE: Record<string, ZoneSlug> = {
  NCTF3: 'rostro', // skinbooster, full-face mesotherapy
  WS: 'rostro', // Watershield
  DQ: 'rostro', // Dermaquench
  LB: 'rostro', // Lifting B
  BC: 'rostro', // Bioestimulador de Colágeno
  JB: 'intima', // Sensiclean — pre-2026-07-25 code, kept: still a live alias
  SENS: 'intima', // Sensiclean (intimate hygiene)
  H: 'ninguna', // Hialuronidasa dissolves filler anywhere
  HIAL: 'ninguna',
  NCTF: 'rostro', // NCTF-3s after the recode
  RE: 'ninguna', // Reserva de Consulta (deposit)
  AJ: 'ninguna', // Ajuste por Método de Pago (fee)
  T1Z: 'variable', // "1 zona" — which zone is chosen at sale time
  T2Z: 'variable',
  'FACES 4788': 'variable', // "BOTOX 1 zona"
  D01: 'variable', // Dúo MIFILL — the two zones are picked per sale
};

export function inferZone(name: string, code?: string): ZoneSlug {
  if (code && ZONE_BY_CODE[code]) return ZONE_BY_CODE[code];
  for (const [re, zone] of ZONE_PATTERNS) if (re.test(name)) return zone;
  return 'ninguna';
}

// ── Line inference ─────────────────────────────────────────────────────────
// "Plus" MUST be tested before bare "Volume", and Opera IV/III/II before I,
// or every longer variant collapses into its shorter prefix.
const LINE_PATTERNS: Array<[RegExp, LineSlug]> = [
  [/saypha\s*volume\s*plus|\bsvp\b/i, 'saypha-volume-plus'],
  [/saypha\s*volume/i, 'saypha-volume'],
  [/saypha\s*filler/i, 'saypha-filler'],
  [/saypha/i, 'saypha'],
  [/opera\s*(iv|4)\b/i, 'opera-iv'],
  [/opera\s*(iii|3)\b/i, 'opera-iii'],
  [/opera\s*(ii|2)\b/i, 'opera-ii'],
  [/opera\s*(i|1)\b/i, 'opera-i'],
  [/opera\s*corp/i, 'opera-corp'],
  [/opera/i, 'opera'],
  [/mifill/i, 'mifill'],
  [/botox|toxina/i, 'toxina'],
  [/nctf/i, 'nctf'],
  [/hialuronidasa/i, 'hialuronidasa'],
  // "Afinamiento (de Rostro|Facial)" is NOT matched here on purpose: face
  // slimming is deoxycholic acid in some clinics and masseter toxin in others,
  // and nothing in this data settles it. It falls through to 'por-definir'
  // rather than being guessed from its price band.
  [/desoxic[oó]lico|slim\s*body/i, 'ac-desoxicolico'],
  [/bioestimulador/i, 'bioestimulador'],
  [/faja/i, 'prenda'],
];

/** stk_items.name → line. The insumo the sale burns is authoritative. */
const LINE_BY_ITEM: Array<[RegExp, LineSlug]> = [
  [/saypha\s*volume\s*plus/i, 'saypha-volume-plus'],
  [/saypha\s*volume/i, 'saypha-volume'],
  [/saypha\s*filler/i, 'saypha-filler'],
  [/opera\s*corp/i, 'opera-corp'],
  [/opera\s*iv/i, 'opera-iv'],
  [/opera\s*iii/i, 'opera-iii'],
  [/opera\s*ii/i, 'opera-ii'],
  [/opera\s*i\b/i, 'opera-i'],
  [/toxina/i, 'toxina'],
  [/nctf/i, 'nctf'],
  [/hialuronidasa/i, 'hialuronidasa'],
  [/desoxic[oó]lico/i, 'ac-desoxicolico'],
  [/bioestimulador/i, 'bioestimulador'],
  [/faja/i, 'prenda'],
];

const LINE_BY_CODE: Record<string, LineSlug> = {
  RE: 'ninguno',
  AJ: 'ninguno',
  LD: 'cosmetico', // Lip Defender
  EU: 'cosmetico', // Eudaria
  JIEU: 'cosmetico', // Jabón íntimo Eudaria
  JB: 'cosmetico', // Sensiclean — pre-recode code, still a live alias
  SENS: 'cosmetico',
  HIAL: 'hialuronidasa',
  NCTF: 'nctf',
  FAJG: 'prenda',
  FAJS: 'prenda',
  FAJM: 'prenda',
  FAJL: 'prenda',
  WS: 'cosmetico', // Watershield
  DQ: 'cosmetico', // Dermaquench
  LB: 'cosmetico', // Lifting B
  'F-G': 'prenda',
  SG: 'toxina', // Sonrisa Gingival is a toxin injection
  // NOT listed: LDP "LABIOS DEEP". Its price (800) sits next to L01 "Lips
  // Sculpt MIFILL" (790), but a price band is not evidence of an insumo — it
  // stays 'por-definir' until someone confirms.
};

/**
 * @param consumedItemNames every stk_items.name this product maps to via
 *   stk_consumption.
 *
 * ⚠️ A mapping is only treated as authoritative when there is EXACTLY ONE.
 * stk_consumption records what a sale burns, not which of those is the
 * *therapeutic* ingredient — the schema happily holds filler + lidocaine +
 * needle + gloves. Today all 34 live mappings are a single filler each, so the
 * shortcut is correct right now; the moment someone maps an anaesthetic, "first
 * mapped item wins" would relabel that product's line to 'Lidocaína'. With two
 * or more mappings we fall through to the name and, failing that, to
 * 'por-definir' — a human picks the primary. Give stk_consumption an ingredient
 * ROLE column and this guard can be replaced by "the row where role='primary'".
 */
export function inferLine(
  name: string,
  code?: string,
  consumedItemNames?: string[] | string | null,
  zone?: ZoneSlug,
): LineSlug {
  const mapped =
    consumedItemNames == null
      ? []
      : Array.isArray(consumedItemNames)
        ? consumedItemNames.filter(Boolean)
        : [consumedItemNames];
  if (mapped.length === 1) {
    for (const [re, line] of LINE_BY_ITEM) if (re.test(mapped[0])) return line;
  }
  if (code && LINE_BY_CODE[code]) return LINE_BY_CODE[code];
  for (const [re, line] of LINE_PATTERNS) if (re.test(name)) return line;
  // Nothing identified the insumo. Which "unknown" this is depends on whether
  // the row is even clinical: a row that names a body part is a treatment with
  // an unrecorded insumo ('por-definir', an audit item); a row that names none
  // is a fee or deposit ('ninguno', correctly a Cargo).
  return zone && zone !== 'ninguna' ? 'por-definir' : 'ninguno';
}

const CATEGORY_BY_LINE: Record<LineSlug, CategoryName> = {
  'opera-i': 'Relleno',
  'opera-ii': 'Relleno',
  'opera-iii': 'Relleno',
  'opera-iv': 'Relleno',
  'opera-corp': 'Relleno',
  opera: 'Relleno',
  'saypha-filler': 'Relleno',
  'saypha-volume': 'Relleno',
  'saypha-volume-plus': 'Relleno',
  saypha: 'Relleno',
  mifill: 'Relleno',
  toxina: 'Toxina',
  nctf: 'Mesoterapia',
  hialuronidasa: 'Corrección',
  'ac-desoxicolico': 'Lipólisis',
  bioestimulador: 'Bioestimulación',
  cosmetico: 'Cosmético',
  prenda: 'Prenda',
  'por-definir': 'Por clasificar',
  ninguno: 'Cargo',
};

/** Bundles are their own kind regardless of what their children use. */
export function inferCategory(line: LineSlug, isBundle = false): CategoryName {
  return isBundle ? 'Paquete' : CATEGORY_BY_LINE[line];
}

export const CATEGORY_ORDER: CategoryName[] = [
  'Relleno',
  'Toxina',
  'Bioestimulación',
  'Mesoterapia',
  'Lipólisis',
  'Corrección',
  'Paquete',
  'Cosmético',
  'Prenda',
  'Cargo',
  'Por clasificar',
];

/**
 * How a field's value was arrived at. Stored PER FIELD, not once per row: a
 * product routinely has a name-inferred zone and a stock-mapped line, and one
 * combined flag would force the pair to the weaker of the two and make the
 * "which of these do I still need to check?" question unanswerable.
 *
 *   mapped   — derived from the stk_consumption mapping (authoritative)
 *   inferred — pattern-matched from the name or a hardcoded code override
 *   manual   — a human set it; NEVER overwrite this in a re-run
 */
export type TaxonomySource = 'mapped' | 'inferred' | 'manual';

/** Full classification for one catalog row. */
export interface Taxonomy {
  zone: ZoneSlug;
  line: LineSlug;
  category: CategoryName;
  zoneSource: TaxonomySource;
  lineSource: TaxonomySource;
}

export function classify(
  name: string,
  code?: string,
  consumedItemNames?: string[] | string | null,
  isBundle = false,
): Taxonomy {
  const mapped =
    consumedItemNames == null
      ? []
      : Array.isArray(consumedItemNames)
        ? consumedItemNames.filter(Boolean)
        : [consumedItemNames];
  const zone = inferZone(name, code);
  const line = inferLine(name, code, mapped, zone);
  // 'mapped' only when the single mapping is what actually produced `line` —
  // a mapping that matched none of LINE_BY_ITEM left us on the name path.
  const fromMapping =
    mapped.length === 1 && LINE_BY_ITEM.some(([re]) => re.test(mapped[0]));
  return {
    zone,
    line,
    category: inferCategory(line, isBundle),
    zoneSource: 'inferred',
    lineSource: fromMapping ? 'mapped' : 'inferred',
  };
}
