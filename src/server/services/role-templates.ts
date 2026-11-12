import { type ActionSet, type Module } from './rbac.service';
const BUSINESS_V1: readonly string[] = [
  'crm',
  'finance',
  'sales',
  'scheduling',
  'support',
  'projects',
  'memberships',
  'comms',
  'brains',
  'stock',
  'ads',
  'pos',
  'pulse',
];
const MODULES_V1: readonly string[] = [
  'overview',
  ...BUSINESS_V1,
  'agents',
  'channels',
  'flows',
  'marketplace',
  'reliability',
  'workspace',
  'settings',
  'users',
  'roles',
  'tools',
];

export type RoleTemplateId = 'admin' | 'manager' | 'staff' | 'viewer';
export interface RoleTemplate {
  id: RoleTemplateId;
  name: string;
  version: number;
  rank: number;
  description: string;
}
const TEMPLATES: readonly RoleTemplate[] = [
  {
    id: 'admin',
    name: 'Administrator',
    version: 1,
    rank: 80,
    description: 'Full organization access and administration.',
  },
  {
    id: 'manager',
    name: 'Manager',
    version: 1,
    rank: 60,
    description: 'Manage business operations with limited platform access.',
  },
  {
    id: 'staff',
    name: 'Staff',
    version: 1,
    rank: 40,
    description: 'Day-to-day customer, scheduling and stock work.',
  },
  { id: 'viewer', name: 'Viewer', version: 1, rank: 10, description: 'Read business information.' },
];
export const roleTemplates = (): RoleTemplate[] => TEMPLATES.map((t) => ({ ...t }));
export function getRoleTemplate(id: string, version = 1): RoleTemplate {
  const template = TEMPLATES.find((t) => t.id === id && t.version === version);
  if (!template) throw new Error('Unknown role template version');
  return { ...template };
}
const caps = (enabled: readonly string[]): ActionSet => ({
  view: enabled.includes('view'),
  create: enabled.includes('create'),
  edit: enabled.includes('edit'),
  delete: enabled.includes('delete'),
  export: enabled.includes('export'),
  manage: enabled.includes('manage'),
});
/** Frozen v1 definitions: template copies do not depend on an organization's overrides. */
export function templateCaps(id: RoleTemplateId, module: Module, version = 1): ActionSet {
  getRoleTemplate(id, version);
  if (!MODULES_V1.includes(module)) return caps([]);
  if (module === 'overview') return caps(['view']);
  if (id === 'admin') return caps(['view', 'create', 'edit', 'delete', 'export', 'manage']);
  if (id === 'manager') {
    if (module === 'roles') return caps(['view', 'create', 'edit', 'delete']);
    if (module === 'pos') return caps(['view', 'create', 'edit', 'export', 'manage']);
    if (BUSINESS_V1.includes(module)) return caps(['view', 'create', 'edit', 'export']);
    return caps(['view']);
  }
  if (id === 'staff') {
    if (['crm', 'scheduling', 'support', 'comms', 'pos', 'stock'].includes(module))
      return caps(['view', 'create', 'edit']);
    if (['finance', 'sales', 'projects', 'memberships'].includes(module)) return caps(['view']);
    return caps([]);
  }
  return BUSINESS_V1.includes(module) ? caps(['view']) : caps([]);
}
