import type {
  CreateCustomPropertyInput,
  CustomPropertyBundle,
  CustomPropertyDefinition,
  CustomPropertyLifecycleInput,
  CustomPropertyTableId,
  CustomPropertyValue,
  CustomPropertyValueCell,
  UpdateCustomPropertyInput,
} from '$lib/tables/custom-properties';
import type { CustomPropertyManagerActions, CustomPropertyValueActions } from './types';

export class CustomPropertyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let code = `http_${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      code = body.message ?? code;
    } catch {
      // Keep the status-derived code when the response has no JSON body.
    }
    throw new CustomPropertyHttpError(response.status, code);
  }
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export async function loadCustomPropertyDefinitions(tableId: CustomPropertyTableId) {
  const params = new URLSearchParams({ tableId, includeArchived: '1' });
  return request<{
    definitions: CustomPropertyDefinition[];
    canManage: boolean;
    canEdit: boolean;
  }>(`/api/tables/properties?${params}`);
}

export async function loadCustomPropertyBundle(
  tableId: CustomPropertyTableId,
  recordIds: string[],
) {
  return request<CustomPropertyBundle>(
    '/api/tables/properties/values/query',
    json('POST', { tableId, recordIds }),
  );
}

export function createCustomPropertyManagerActions(): CustomPropertyManagerActions {
  return {
    async list(tableId: string) {
      return (await loadCustomPropertyDefinitions(tableId)).definitions;
    },
    async create(input: CreateCustomPropertyInput) {
      return (
        await request<{ definition: CustomPropertyDefinition }>(
          '/api/tables/properties',
          json('POST', input),
        )
      ).definition;
    },
    async update(definition: CustomPropertyDefinition, input: UpdateCustomPropertyInput) {
      return (
        await request<{ definition: CustomPropertyDefinition }>(
          `/api/tables/properties/${definition.id}`,
          json('PATCH', input),
        )
      ).definition;
    },
    async lifecycle(definition: CustomPropertyDefinition, input: CustomPropertyLifecycleInput) {
      const method = input.action === 'archive' ? 'DELETE' : 'PATCH';
      const body =
        input.action === 'archive'
          ? { tableId: input.tableId, expectedVersion: input.expectedVersion }
          : input;
      return (
        await request<{ definition: CustomPropertyDefinition }>(
          `/api/tables/properties/${definition.id}`,
          json(method, body),
        )
      ).definition;
    },
  };
}

export function createCustomPropertyValueActions(
  tableId: CustomPropertyTableId,
  onrefresh?: () => Promise<void>,
): CustomPropertyValueActions {
  return {
    async save(definition, recordId, value, expectedVersion) {
      const { cell } = await request<{ cell: CustomPropertyValueCell }>(
        '/api/tables/properties/values',
        json('PUT', {
          tableId,
          propertyId: definition.id,
          recordId,
          value,
          expectedVersion,
        }),
      );
      let refreshFailed = false;
      try {
        await onrefresh?.();
      } catch {
        refreshFailed = true;
      }
      return { cell, refreshFailed };
    },
    async read(propertyId, recordId) {
      const bundle = await loadCustomPropertyBundle(tableId, [recordId]);
      return bundle.values[recordId]?.[propertyId] ?? null;
    },
  };
}
