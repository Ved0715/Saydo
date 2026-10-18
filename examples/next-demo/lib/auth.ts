import type { SaydoUser } from 'saydo-js';

// Stand-in for your auth (Auth.js, Clerk, Supabase...). Everyone is the demo user.
export async function getUser(_request?: Request): Promise<SaydoUser> {
  return { id: 'demo', name: 'Demo user', role: 'member' };
}
