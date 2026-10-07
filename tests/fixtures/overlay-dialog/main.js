import { mount } from 'svelte';
import './fixture.css';
import Fixture from './Fixture.svelte';
const target = document.getElementById('app');
if (!target) throw new Error('Fixture mount target missing');
mount(Fixture, { target });
