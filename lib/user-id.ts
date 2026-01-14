const USER_ID_KEY = 'wallet-to-social-user-id';

/**
 * Get or create a unique user ID stored in localStorage.
 * Used to associate lookups with users until proper auth is implemented.
 */
export function getUserId(): string {
  if (typeof window === 'undefined') return '';

  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}
