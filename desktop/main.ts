import { mount } from 'svelte';
import Updater from '../src/lib/components/desktop-updater/Updater.svelte';
import './style.css';
import { setLanguageTag } from '../src/lib/paraglide/runtime';
const language = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
setLanguageTag(language);
document.documentElement.lang = language;
mount(Updater, { target: document.getElementById('app')! });
