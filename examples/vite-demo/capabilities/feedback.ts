import { z } from 'zod';
import { action, toast } from 'saydo-js';

const inbox: Array<{ message: string; at: string }> = [];

// File path = id: capabilities/feedback.ts → "feedback". Write → the user confirms first.
export default action({
  describe: 'Send feedback to the product team',
  input: z.object({ message: z.string().min(3).max(500) }),
  risk: 'write',
  handler: ({ message }) => {
    inbox.push({ message, at: new Date().toISOString() });
    return { result: { received: inbox.length }, effects: [toast('Thanks! Feedback sent.')] };
  },
});
