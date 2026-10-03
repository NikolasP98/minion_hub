import { fetchJson } from '$lib/api/fetch-json';
import { hrErrorMessage } from './hr-error';

/** One selection's read: replacing or closing it makes late replies inert. */
export function createTeamRead<T>() {
  let data = $state<T | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let revision = 0;
  let controller: AbortController | undefined;
  let currentUrl: string | null = null;

  function reset() {
    revision++;
    controller?.abort();
    controller = undefined;
    currentUrl = null;
    data = null;
    error = null;
    loading = false;
  }

  async function load(url: string) {
    const own = ++revision;
    controller?.abort();
    controller = new AbortController();
    currentUrl = url;
    data = null;
    error = null;
    loading = true;
    try {
      const result = await fetchJson<T>(url, { signal: controller.signal });
      if (revision === own) data = result;
    } catch (cause) {
      if (revision === own) error = hrErrorMessage(cause);
    } finally {
      if (revision === own) loading = false;
    }
  }

  return {
    get data() {
      return data;
    },
    get error() {
      return error;
    },
    get loading() {
      return loading;
    },
    load,
    reset,
    retry: () => (currentUrl ? load(currentUrl) : Promise.resolve()),
  };
}
