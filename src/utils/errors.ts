///src/utils/errors.ts

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(404, `${what} not found`, "NOT_FOUND");
export const conflict = (msg: string, code = "CONFLICT") => new AppError(409, msg, code);
export const forbidden = (msg = "Forbidden") => new AppError(403, msg, "FORBIDDEN");
export const locked = (msg: string) => new AppError(423, msg, "LOCKED");