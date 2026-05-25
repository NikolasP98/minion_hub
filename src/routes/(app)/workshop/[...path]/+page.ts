import { redirect } from '@sveltejs/kit';

// Workshop moved under /agents/workshop. Keep old /workshop and /workshop/:id
// links working (308 = permanent, preserves method).
export function load({ params }: { params: { path: string } }) {
    const rest = params.path ? `/${params.path}` : '';
    redirect(308, `/agents/workshop${rest}`);
}
