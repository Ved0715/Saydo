// The playground board's actions. No handlers here: the board implements them in the browser
// with useCapability, so this file is safe to import from client components.
import { z } from 'zod';
import { action } from 'saydo';

export const addTask = action({
  id: 'board.add',
  title: 'Add a task',
  describe: 'Add a task to the launch checklist on the playground board',
  input: z.object({ title: z.string().min(1).max(80) }),
  risk: 'write',
  entry: '/',
});

export const removeTasks = action({
  id: 'board.remove',
  title: 'Remove tasks',
  describe: 'Remove tasks from the launch checklist, by their exact titles',
  input: z.object({ titles: z.array(z.string().min(1)).min(1).max(20) }),
  risk: 'destructive',
  entry: '/',
});
