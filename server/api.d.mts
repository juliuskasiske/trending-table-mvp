// Minimal ambient types for the JS API module so vite.config.ts type-checks
// without pulling in @types/express. The runtime returns real Express objects;
// these signatures only need to satisfy `server.middlewares.use(...)`.

/** A connect/Express-compatible request handler. */
type RequestHandler = (req: unknown, res: unknown, next: (err?: unknown) => void) => void;

/** Express Router exposing the /config, /places/*, and /stripe/* endpoints. */
export function createApiRouter(): RequestHandler;

/** Standalone Express app wrapping the router (for connect-style hosts). */
export function createApiApp(): RequestHandler;
