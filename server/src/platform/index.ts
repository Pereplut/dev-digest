/* platform barrel — the cross-cutting helpers a module may import directly.
   Kept deliberately small: anything that talks to an external system belongs
   behind a port in the container, not here. */
export { formatRunDuration, NO_DURATION } from './duration.js';
