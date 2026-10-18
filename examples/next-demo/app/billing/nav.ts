import { z } from 'zod';
import { defineRoute } from 'saydo-js';

// Optional metadata. URL state declared here becomes a free, typed UI capability.
export default defineRoute({
  title: 'Billing',
  aliases: ['invoices', 'payments', 'subscription'],
  search: z.object({ status: z.enum(['paid', 'unpaid']).optional() }),
});
