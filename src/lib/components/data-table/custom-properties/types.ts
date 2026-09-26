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

export interface CustomPropertyTableConfig<T> {
  /** Stable organization + source identity; changing it clears all cached cells and permissions. */
  scopeKey: string;
  bundle: CustomPropertyBundle;
  recordId: (row: T) => string | null;
  onrefresh?: () => Promise<void>;
}

export interface CustomPropertyManagerActions {
  list: (tableId: CustomPropertyTableId) => Promise<CustomPropertyDefinition[]>;
  create: (input: CreateCustomPropertyInput) => Promise<CustomPropertyDefinition>;
  update: (
    definition: CustomPropertyDefinition,
    input: UpdateCustomPropertyInput,
  ) => Promise<CustomPropertyDefinition>;
  lifecycle: (
    definition: CustomPropertyDefinition,
    input: CustomPropertyLifecycleInput,
  ) => Promise<CustomPropertyDefinition>;
}

export interface CustomPropertyValueActions {
  save: (
    definition: CustomPropertyDefinition,
    recordId: string,
    value: CustomPropertyValue,
    expectedVersion: number,
  ) => Promise<{ cell: CustomPropertyValueCell; refreshFailed: boolean }>;
  read: (propertyId: string, recordId: string) => Promise<CustomPropertyValueCell | null>;
}
