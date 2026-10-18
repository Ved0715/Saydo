import { defineRoute } from 'saydo';

// Server-side visibility: never sent to the model or palette for other users.
export default defineRoute({ access: (user) => user.role === 'admin' });
