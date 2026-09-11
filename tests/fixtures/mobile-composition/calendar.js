import { mount } from 'svelte';
import '../../../src/app.css';
import './fixture.css';
import Fixture from './CalendarFixture.svelte';
const target = document.getElementById('app');
if (!target) throw new Error('Fixture mount target missing');
mount(Fixture, { target });
