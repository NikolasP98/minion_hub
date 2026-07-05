import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getPostDetail } from '$server/services/meta/meta-insights.service';

export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'ads'))) throw error(404, 'Ads module disabled');

  const postId = decodeURIComponent(params.postId);
  const post = await getPostDetail(ctx, postId);
  if (!post) throw error(404, 'Post not found');

  return { post };
};
