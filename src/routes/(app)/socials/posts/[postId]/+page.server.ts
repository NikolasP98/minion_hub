import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getPostDetail } from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await datasetCtx(locals, 'ads');
  if (isDenied(ctx)) return { ads: ctx }; // rendered by DataSource (spec 039)
  const postId = decodeURIComponent(params.postId);
  const post = await getPostDetail(ctx, postId);
  if (!post) throw error(404, 'Post not found');

  return { ads: { post } };
};
