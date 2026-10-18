// Virtual modules provided by the saydo Vite plugin (server/SSR only).
declare module 'virtual:saydo/handler' {
  export const POST: (request: Request) => Promise<Response>;
}
