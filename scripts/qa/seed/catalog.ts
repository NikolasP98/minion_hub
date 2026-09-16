/**
 * Catalog — fin_products (sellables) + fin_product_components (bundles).
 * Stock links (raw-material component, consumption mappings) are created in
 * stock.ts against the product ids exported here, per the seed order in the
 * task brief (parties → crm → catalog → stock items/warehouses/consumption).
 */
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS } from './tenancy';
import type { SeedContext } from './db';

export const PRODUCT_SERVICE_PLAIN = matrixUuid('catalog.service.plain');
export const PRODUCT_TRACKED = matrixUuid('catalog.product.tracked');
export const PRODUCT_RAW_MATERIAL_LINK = matrixUuid('catalog.product.raw-material-link');
export const PRODUCT_BUNDLE_TWO_SERVICES = matrixUuid('catalog.bundle.two-services');
export const PRODUCT_PACKAGE_WITH_VALIDITY = matrixUuid('catalog.package.with-validity');
export const PRODUCT_PACKAGE_NO_VALIDITY = matrixUuid('catalog.package.no-validity');
export const PRODUCT_CONSUMPTION_2_ITEMS = matrixUuid('catalog.product.consumption-2-items');
export const PRODUCT_SELLABLE_INACTIVE = matrixUuid('catalog.sellable.inactive');
export const PRODUCT_ALIASES_AND_ZONE = matrixUuid('catalog.product.aliases-and-zone');
// Bundle children for catalog.bundle.two-services / catalog.package.*
export const PRODUCT_BUNDLE_CHILD_A = matrixUuid('catalog.bundle.two-services', 'child-a');
export const PRODUCT_BUNDLE_CHILD_B = matrixUuid('catalog.bundle.two-services', 'child-b');

interface ProductRow {
  matrixId: string;
  id: string;
  code: string;
  name: string;
  category: string;
  unitPrice: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register } = ctx;

  const products: ProductRow[] = [
    {
      matrixId: 'catalog.service.plain',
      id: PRODUCT_SERVICE_PLAIN,
      code: 'SVCP',
      name: 'QA Plain Service',
      category: 'service',
      unitPrice: '80.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.product.tracked',
      id: PRODUCT_TRACKED,
      code: 'TRKD',
      name: 'QA Tracked Product',
      category: 'product',
      unitPrice: '35.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.product.raw-material-link',
      id: PRODUCT_RAW_MATERIAL_LINK,
      code: 'RMLK',
      name: 'QA Raw-Material-Linked Product',
      category: 'product',
      unitPrice: '20.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.bundle.two-services',
      id: PRODUCT_BUNDLE_TWO_SERVICES,
      code: 'BND2',
      name: 'QA Two-Service Bundle',
      category: 'bundle',
      unitPrice: '150.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.bundle.two-services (child a)',
      id: PRODUCT_BUNDLE_CHILD_A,
      code: 'BCHA',
      name: 'QA Bundle Child A',
      category: 'service',
      unitPrice: '80.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.bundle.two-services (child b)',
      id: PRODUCT_BUNDLE_CHILD_B,
      code: 'BCHB',
      name: 'QA Bundle Child B',
      category: 'service',
      unitPrice: '70.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.package.with-validity',
      id: PRODUCT_PACKAGE_WITH_VALIDITY,
      code: 'PKGV',
      name: 'QA Package (90d validity)',
      category: 'package',
      unitPrice: '400.00',
      active: true,
      metadata: { packageValidityDays: 90 },
    },
    {
      matrixId: 'catalog.package.no-validity',
      id: PRODUCT_PACKAGE_NO_VALIDITY,
      code: 'PKGN',
      name: 'QA Package (no validity)',
      category: 'package',
      unitPrice: '360.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.product.consumption-2-items',
      id: PRODUCT_CONSUMPTION_2_ITEMS,
      code: 'CON2',
      name: 'QA Consumption Product',
      category: 'service',
      unitPrice: '55.00',
      active: true,
      metadata: {},
    },
    {
      matrixId: 'catalog.sellable.inactive',
      id: PRODUCT_SELLABLE_INACTIVE,
      code: 'INAC',
      name: 'QA Inactive Sellable',
      category: 'service',
      unitPrice: '25.00',
      active: false,
      metadata: {},
    },
    {
      matrixId: 'catalog.product.aliases-and-zone',
      id: PRODUCT_ALIASES_AND_ZONE,
      code: 'AZ',
      name: humanId('PROD', 'catalog.product.aliases-and-zone'),
      category: 'product',
      unitPrice: '18.00',
      active: true,
      metadata: { aliases: ['LEGACY-AZ', 'AZ-OLD'], zone: 'face', line: 'skincare' },
    },
  ];

  for (const p of products) {
    await sql`
      insert into fin_products (id, org_id, code, name, category, unit_price, active, metadata)
      values (${p.id}, ${ORG_BUSINESS}, ${p.code}, ${p.name}, ${p.category}, ${p.unitPrice}, ${p.active}, ${sql.json(p.metadata)})
      on conflict (org_id, code) do update set
        name = excluded.name, category = excluded.category, unit_price = excluded.unit_price,
        active = excluded.active, metadata = excluded.metadata
    `;
  }
  for (const matrixId of [
    'catalog.service.plain',
    'catalog.product.tracked',
    'catalog.product.raw-material-link',
    'catalog.bundle.two-services',
    'catalog.package.with-validity',
    'catalog.package.no-validity',
    'catalog.product.consumption-2-items',
    'catalog.sellable.inactive',
    'catalog.product.aliases-and-zone',
  ]) {
    const id = products.find((p) => p.matrixId === matrixId)!.id;
    register(matrixId, { table: 'fin_products', where: { id } });
  }

  await sql`
    insert into fin_product_components (org_id, bundle_product_id, child_product_id, qty, line_no)
    values
      (${ORG_BUSINESS}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_A}, 1, 0),
      (${ORG_BUSINESS}, ${PRODUCT_BUNDLE_TWO_SERVICES}, ${PRODUCT_BUNDLE_CHILD_B}, 1, 1),
      (${ORG_BUSINESS}, ${PRODUCT_PACKAGE_WITH_VALIDITY}, ${PRODUCT_SERVICE_PLAIN}, 1, 0),
      (${ORG_BUSINESS}, ${PRODUCT_PACKAGE_NO_VALIDITY}, ${PRODUCT_SERVICE_PLAIN}, 1, 0)
    on conflict (org_id, bundle_product_id, child_product_id) do update set qty = excluded.qty
  `;
}
