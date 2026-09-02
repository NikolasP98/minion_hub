/**
 * Realistic user requests (EN + ES, Peru vocabulary) with the page the
 * assistant should land on. `expectPath: null` = no such module: the search
 * must NOT be confident, but `expectSuggestion` (if set) must be the closest
 * page offered. Consumed by use-cases.test.ts (searchPages) and by the live
 * prompt-contract test against the real model.
 */
export interface UseCase {
  text: string;
  stage: 'I' | 'II' | 'III' | 'ambiguous' | 'nonexistent';
  lang: 'en' | 'es';
  expectPath: string | null;
  /** Form id from FORM_CATALOG the model should fill/guide (stages II–III). */
  expectForm?: string;
  /** For nonexistent modules: the closest page that should top the suggestions. */
  expectSuggestion?: string;
}

export const USE_CASES: UseCase[] = [
  // Stage I — where / how do I…
  { text: 'where do I submit invoices?', stage: 'I', lang: 'en', expectPath: '/finances/invoices' },
  {
    text: 'how do I add new stock entries?',
    stage: 'I',
    lang: 'en',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  {
    text: 'I just bought 4 boxes of X, where do I put it?',
    stage: 'I',
    lang: 'en',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  { text: 'how do I use the POS?', stage: 'I', lang: 'en', expectPath: '/pos/sell' },
  { text: 'where do I see the kardex?', stage: 'I', lang: 'en', expectPath: '/stock/entries' },
  {
    text: 'where can I see my bookings for tomorrow?',
    stage: 'I',
    lang: 'en',
    expectPath: '/scheduling/bookings',
  },
  {
    text: 'where do I add a new supplier?',
    stage: 'I',
    lang: 'en',
    expectPath: '/crm/customers',
    expectForm: 'party',
  },
  {
    text: 'how do I change roles and permissions?',
    stage: 'I',
    lang: 'en',
    expectPath: '/settings/roles',
  },
  {
    text: '¿dónde registro una factura de compra?',
    stage: 'I',
    lang: 'es',
    expectPath: '/finances/purchases',
    expectForm: 'purchase',
  },
  {
    text: '¿cómo agrego insumos al almacén?',
    stage: 'I',
    lang: 'es',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  {
    text: '¿dónde veo mis citas de hoy?',
    stage: 'I',
    lang: 'es',
    expectPath: '/scheduling/bookings',
  },
  {
    text: '¿dónde está el ingreso de mercadería?',
    stage: 'I',
    lang: 'es',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  {
    text: '¿dónde veo los comprobantes emitidos?',
    stage: 'I',
    lang: 'es',
    expectPath: '/finances/invoices',
  },
  {
    text: '¿cómo creo un nuevo almacén?',
    stage: 'I',
    lang: 'es',
    expectPath: '/stock/warehouses',
    expectForm: 'warehouse',
  },
  {
    text: '¿dónde configuro los recordatorios de whatsapp?',
    stage: 'I',
    lang: 'es',
    expectPath: '/scheduling/reminders',
  },
  { text: '¿dónde veo las membresías?', stage: 'I', lang: 'es', expectPath: '/memberships' },
  // Stage II — show me how / teach me
  {
    text: 'show me how to create a service bundle',
    stage: 'II',
    lang: 'en',
    expectPath: '/pos/catalog/new',
    expectForm: 'sellable',
  },
  {
    text: 'teach me how to register a purchase invoice',
    stage: 'II',
    lang: 'en',
    expectPath: '/finances/purchases',
    expectForm: 'purchase',
  },
  {
    text: 'show me how to create a stock item',
    stage: 'II',
    lang: 'en',
    expectPath: '/stock/items',
    expectForm: 'stock_item',
  },
  {
    text: 'enséñame a agendar una cita',
    stage: 'II',
    lang: 'es',
    expectPath: '/scheduling/bookings/new',
    expectForm: 'booking',
  },
  {
    text: 'muéstrame cómo registrar un cliente nuevo',
    stage: 'II',
    lang: 'es',
    expectPath: '/crm/customers',
    expectForm: 'party',
  },
  {
    text: 'enséñame a hacer un ingreso de mercadería',
    stage: 'II',
    lang: 'es',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  // Stage III — do it for me (values given)
  {
    text: 'add 4 boxes of Botox into inventory at 1200 each',
    stage: 'III',
    lang: 'en',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  {
    text: 'the sale is for customer Maria',
    stage: 'III',
    lang: 'en',
    expectPath: '/pos/sell',
    expectForm: 'pos_sale',
  },
  {
    text: 'create a customer Juan Perez with DNI 12345678',
    stage: 'III',
    lang: 'en',
    expectPath: '/crm/customers',
    expectForm: 'party',
  },
  {
    text: 'book a cleaning appointment for Ana tomorrow at 10:00',
    stage: 'III',
    lang: 'en',
    expectPath: '/scheduling/bookings/new',
    expectForm: 'booking',
  },
  {
    text: 'registra la factura F001-123 de proveedor X por 500 soles',
    stage: 'III',
    lang: 'es',
    expectPath: '/finances/purchases',
    expectForm: 'purchase',
  },
  {
    text: 'compré 4 cajas de guantes a 30 soles cada una',
    stage: 'III',
    lang: 'es',
    expectPath: '/stock/entries/new',
    expectForm: 'stock_entry',
  },
  {
    text: 'crea el producto Limpieza facial a 150 soles',
    stage: 'III',
    lang: 'es',
    expectPath: '/pos/catalog/new',
    expectForm: 'sellable',
  },
  // Ambiguous — single words / vague intent
  { text: 'I need to do stock', stage: 'ambiguous', lang: 'en', expectPath: '/stock' },
  { text: 'clientes', stage: 'ambiguous', lang: 'es', expectPath: '/crm/customers' },
  { text: 'ventas', stage: 'ambiguous', lang: 'es', expectPath: '/sales' },
  { text: 'caja', stage: 'ambiguous', lang: 'es', expectPath: '/pos/sell' },
  { text: 'agenda', stage: 'ambiguous', lang: 'es', expectPath: '/scheduling/calendar' },
  { text: 'inventario', stage: 'ambiguous', lang: 'es', expectPath: '/stock' },
  { text: 'facturas', stage: 'ambiguous', lang: 'es', expectPath: '/finances/invoices' },
  { text: 'servicios', stage: 'ambiguous', lang: 'es', expectPath: '/pos/catalog' },
  { text: 'redes sociales', stage: 'ambiguous', lang: 'es', expectPath: '/socials' },
  { text: 'settings', stage: 'ambiguous', lang: 'en', expectPath: '/settings' },
  // Non-existent modules — must not be confident; closest page suggested
  {
    text: 'open payroll',
    stage: 'nonexistent',
    lang: 'en',
    expectPath: null,
    expectSuggestion: '/team',
  },
  {
    text: 'planilla',
    stage: 'nonexistent',
    lang: 'es',
    expectPath: null,
    expectSuggestion: '/team',
  },
  { text: 'nómina', stage: 'nonexistent', lang: 'es', expectPath: null, expectSuggestion: '/team' },
  { text: 'HR', stage: 'nonexistent', lang: 'en', expectPath: null, expectSuggestion: '/team' },
  {
    text: 'recursos humanos',
    stage: 'nonexistent',
    lang: 'es',
    expectPath: null,
    expectSuggestion: '/team',
  },
  {
    text: 'email marketing',
    stage: 'nonexistent',
    lang: 'en',
    expectPath: null,
    expectSuggestion: '/socials/campaigns',
  },
  {
    text: 'contabilidad',
    stage: 'nonexistent',
    lang: 'es',
    expectPath: null,
    expectSuggestion: '/finances',
  },
  {
    text: 'accounting ledger',
    stage: 'nonexistent',
    lang: 'en',
    expectPath: null,
    expectSuggestion: '/finances',
  },
  {
    text: 'expenses',
    stage: 'nonexistent',
    lang: 'en',
    expectPath: null,
    expectSuggestion: '/finances/purchases',
  },
  {
    text: 'gastos',
    stage: 'nonexistent',
    lang: 'es',
    expectPath: null,
    expectSuggestion: '/finances/purchases',
  },
  {
    text: 'pagos',
    stage: 'nonexistent',
    lang: 'es',
    expectPath: null,
    expectSuggestion: '/finances/invoices',
  },
  { text: 'buy me a coffee', stage: 'nonexistent', lang: 'en', expectPath: null },
  { text: 'zzzz', stage: 'nonexistent', lang: 'en', expectPath: null },
];
