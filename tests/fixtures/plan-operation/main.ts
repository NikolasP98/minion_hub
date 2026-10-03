import { mount } from 'svelte';
import '../../../src/app.css';
import Fixture from './Fixture.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Plan operation fixture mount target missing');
mount(Fixture, { target });
