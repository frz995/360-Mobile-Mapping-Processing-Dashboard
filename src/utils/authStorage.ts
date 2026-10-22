/**
 * Authentication storage key resolution for per-user local storage and cache partitioning.
 * Isolated from UI components to enable clean code-splitting and lazy-loading of heavy workspaces.
 */

export function getAuthStorageUserKey(authSession?: any, isGuestUser?: boolean): string {
  if (isGuestUser) return 'guest';
  const sessionUser = authSession?.user;
  if (sessionUser?.id) return String(sessionUser.id);
  if (sessionUser?.email) return String(sessionUser.email).toLowerCase().trim();

  try {
    const sbKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (sbKey) {
      const raw = localStorage.getItem(sbKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const user = parsed?.user;
        if (user?.id) return String(user.id);
        if (user?.email) return String(user.email).toLowerCase().trim();
      }
    }
  } catch {
    // ignore
  }

  return 'anonymous';
}
