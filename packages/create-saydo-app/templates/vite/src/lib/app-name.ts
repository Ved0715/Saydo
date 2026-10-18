import pkg from '../../package.json';

/** Your project's name, from package.json ("my-app" → "My app"). Rename it here or in package.json. */
export const APP_NAME = pkg.name
  .split(/[-_\s]+/)
  .filter(Boolean)
  .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
  .join(' ');
