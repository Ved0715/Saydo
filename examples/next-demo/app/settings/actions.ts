'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { serverAction } from 'saydo-js';
import { settings } from '@/lib/settings';

// One function for the settings form AND the assistant ("turn off email notifications").
export const updateSettings = serverAction(
  {
    describe: 'Update the user profile settings (display name, email notifications, language)',
    input: z.object({
      displayName: z.string().min(1).max(60).optional(),
      emailNotifications: z.preprocess((v) => (v === 'on' ? true : v === 'off' || v === undefined ? false : v), z.boolean()).optional(),
      language: z.enum(['en', 'es', 'fr']).optional(),
    }),
    risk: 'write',
  },
  async (input) => {
    Object.assign(settings, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    revalidatePath('/settings');
    return { ok: true };
  },
);
