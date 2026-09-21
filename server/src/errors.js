// Every error response has the same shape:
//   { "error": { "code": "snake_case_code", "message": "Human readable", ...details } }

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sign in required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);

// Route stubs for endpoints that later build steps fill in.
export const notImplemented = (step) => (req, res) => {
  res.status(501).json({
    error: {
      code: 'not_implemented',
      message: `${req.method} ${req.baseUrl}${req.route.path} arrives in build step ${step}`,
      step,
    },
  });
};

// Postgres errors the schema raises on purpose, mapped to HTTP.
const PG_ERRORS = {
  '23514': [400, 'constraint_violation'], // check_violation, incl. illegal order status transition
  '23505': [409, 'conflict'], //             unique_violation
  '23503': [400, 'invalid_reference'], //    foreign_key_violation, incl. cross-tenant references
  '22P02': [400, 'invalid_input'], //        e.g. a malformed uuid in the path
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

// Express recognises an error handler by its four parameters, so `next` stays.
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
  }

  const pgError = PG_ERRORS[err.code];
  if (pgError) {
    const [status, code] = pgError;
    return res.status(status).json({ error: { code, message: err.message } });
  }

  // Malformed JSON, oversized body, etc. from express.json().
  if (err.type && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: { code: 'bad_request', message: err.message } });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
