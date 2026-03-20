import * as toast from '@zag-js/toast';

export const toaster = toast.createStore({
  placement: 'top',
  overlap: false,
  max: 6,
});

type ToastOverrides = Partial<toast.Options>;

export function toastInfo(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'info', ...overrides });
}

export function toastSuccess(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'success', duration: 4000, ...overrides });
}

export function toastError(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'error', duration: 8000, ...overrides });
}

export function toastWarning(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'warning', duration: 6000, ...overrides });
}

export function toastLoading(title: string, description?: string, overrides?: ToastOverrides) {
  toaster.create({ title, description, type: 'loading', duration: Infinity, ...overrides });
}
