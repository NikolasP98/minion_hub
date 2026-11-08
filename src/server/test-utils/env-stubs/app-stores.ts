import { readable } from 'svelte/store';
import { page as currentPage } from './app-state';

/** SvelteKit's legacy page store, used by the installed Paraglide provider. */
export const page = readable(currentPage);
