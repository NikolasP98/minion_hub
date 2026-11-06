import { mount } from 'svelte';
import Fixture from './Fixture.svelte';
import '../../../src/app.css';
import './fixture.css';

// Isolated synthetic preview: use the real local preference store and runtime.
// Server synchronization is the only theme dependency stubbed by build.mjs.
const target = document.getElementById('app');
if (!target) throw new Error('Clinic theme fixture mount target is missing');
mount(Fixture, { target });
