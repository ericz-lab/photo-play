/**
 * An error the API answers with: an HTTP status, a stable `code` the page translates
 * (web/i18n.ts, `error.<code>`) with `params`, and an English message for logs and other callers.
 * Text that comes from ai-space or the model is passed on as it is.
 */
export class AppError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly params: Record<string, string | number> = {}) {
    super(message);
  }
}

type P = Record<string, string | number>;
export const badRequest = (code: string, message: string, params?: P) => new AppError(400, code, message, params);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unavailable = (code: string, message: string) => new AppError(503, code, message);
