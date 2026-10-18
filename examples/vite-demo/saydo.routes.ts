import { z } from 'zod';
import { pages } from 'saydo';

// React Router has no file tree to scan, so declare the pages once (React Router paths).
export default pages([
  { path: '/', title: 'Home' },
  { path: '/profile', title: 'Profile', aliases: ['account', 'my details'] },
  { path: '/settings', title: 'Settings', search: z.object({ tab: z.enum(['general', 'notifications']).optional() }) },
  { path: '/feedback', title: 'Feedback', aliases: ['contact', 'support'] },
]);
