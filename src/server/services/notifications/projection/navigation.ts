import type { NotificationNavigationId } from '$lib/notifications/projection-manifest';

const NAVIGATION = Object.freeze({
  'join.review': '/users/join-requests',
  'join.status.approved': '/join/sent',
  'join.status.denied': '/join',
} satisfies Record<NotificationNavigationId, string>);

export function resolveNotificationNavigation(id: NotificationNavigationId): string {
  const path = NAVIGATION[id];
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('..') ||
    path.includes('?') ||
    path.includes('#') ||
    /[\\\u0000-\u001f]/.test(path)
  ) {
    throw new Error('Invalid notification navigation registry');
  }
  return path;
}

export const NOTIFICATION_NAVIGATION = NAVIGATION;
