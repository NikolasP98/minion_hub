import { redirect } from '@sveltejs/kit';

// The Builder hub was dissolved: agents → /agents/builder, skills → /flow-editor
// (Skills view), tools → /tools. Keep the old URL working.
export function load() {
    redirect(308, '/agents/builder');
}
