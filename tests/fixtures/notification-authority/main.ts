import { mount } from 'svelte';
import '../../../src/app.css';
import Fixture from './Fixture.svelte';
const target = document.getElementById('app');
if (!target) throw new Error('Missing fixture target');
mount(Fixture, { target });
