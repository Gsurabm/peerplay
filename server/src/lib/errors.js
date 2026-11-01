export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request', details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(msg, 400, 'bad_request', details);
export const unauthorized = (msg = 'Authentication required') => new AppError(msg, 401, 'unauthorized');
export const forbidden = (msg = 'Not allowed') => new AppError(msg, 403, 'forbidden');
export const notFound = (msg = 'Not found') => new AppError(msg, 404, 'not_found');
export const conflict = (msg) => new AppError(msg, 409, 'conflict');
export const tooMany = (msg = 'Too many requests') => new AppError(msg, 429, 'rate_limited');
export const serverError = (msg = 'Something went wrong') => new AppError(msg, 500, 'server_error');
