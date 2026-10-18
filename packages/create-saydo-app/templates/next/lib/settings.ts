import 'server-only';

export interface Settings {
  displayName: string;
  emailNotifications: boolean;
  language: 'en' | 'es' | 'fr';
}

const g = globalThis as { __demoSettings?: Settings };
export const settings: Settings = (g.__demoSettings ??= { displayName: 'Demo user', emailNotifications: true, language: 'en' });
