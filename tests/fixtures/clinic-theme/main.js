import { mount } from 'svelte';
import Fixture from './Fixture.svelte';
import '../../../src/app.css';
import './fixture.css';

// Isolated synthetic preview: use the real local preference store and runtime.
// Server synchronization is the only theme dependency stubbed by build.mjs.
mount(Fixture, { target: document.getElementById('app') });
