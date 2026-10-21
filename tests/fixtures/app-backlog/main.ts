import { mount } from 'svelte';
import { page } from '$app/state';
import '../../../src/app.css';
import Fixture from './Fixture.svelte';
Object.assign(page, { data: { user:{id:'actor'},activeOrgId:'org' }, url:new URL('http://127.0.0.1:5281/crm') });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('/api/files?')) return Response.json({files:[]});
  if (url.startsWith('/api/')) return Response.json({ok:true});
  return realFetch(input, init);
};
mount(Fixture, { target: document.getElementById('app')! });
