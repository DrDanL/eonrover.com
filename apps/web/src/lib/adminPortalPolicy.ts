/** Server-rendered companion to the API's local-first administrator guard. */
export function isAdminPortalRuntimeEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ADMIN_PORTAL_ENABLED === 'true';
}
