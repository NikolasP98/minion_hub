import { mount } from 'svelte';
import Fixture from './Fixture.svelte';
import '../../../src/app.css';
const target = document.getElementById('app');
if (!target) throw new Error('Workshop fixture mount target missing');
mount(Fixture, { target });
