import { mount } from 'svelte';
import '../../../src/app.css';
import '../mobile-composition/fixture.css';
import Fixture from './CatalogFixture.svelte';
const target = document.getElementById('app');
if (!target) throw new Error('Fixture mount target missing');
mount(Fixture, { target });
