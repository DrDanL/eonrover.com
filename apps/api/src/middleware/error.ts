import { Prisma } from '@prisma/client';
import { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export type ErrorDetails = Record<string, unknown>;

export interface ApiErrorResponse {
  error: string;
  code: ErrorCode;
  details?: ErrorDetails;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function validationDetails(error: ZodError): ErrorDetails | undefined {
  const flattened = error.flatten();
  const details: ErrorDetails = { ...flattened.fieldErrors };
  if (flattened.formErrors.length > 0) details._errors = flattened.formErrors;
  return Object.keys(details).length > 0 ? details : undefined;
}

function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  return typeof error.type === 'string' ? error.type : undefined;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      'The request contains invalid values.',
      validationDetails(error),
    );
  }

  const parserErrorType = bodyParserErrorType(error);
  if (parserErrorType === 'entity.parse.failed') {
    return new AppError(400, ERROR_CODES.BAD_REQUEST, 'Malformed JSON request body.');
  }
  if (parserErrorType === 'entity.too.large') {
    return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large.');
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new AppError(409, ERROR_CODES.CONFLICT, 'A resource with those values already exists.');
    }
    if (error.code === 'P2025') {
      return new AppError(404, ERROR_CODES.NOT_FOUND, 'The requested resource was not found.');
    }
  }

  return new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred.');
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetails,
): void {
  const body: ApiErrorResponse = { error: message, code };
  if (details !== undefined) body.details = details;
  res.status(status).json(body);
}

export function sendValidationError(res: Response, error: ZodError, message = 'Invalid input'): void {
  sendError(res, 400, ERROR_CODES.VALIDATION_ERROR, message, validationDetails(error));
}

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export const rateLimitErrorHandler: RequestHandler = (_req, res) => {
  sendError(res, 429, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.');
};

export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, ERROR_CODES.NOT_FOUND, 'Not found');
};

export const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);
  sendError(res, normalized.status, normalized.code, normalized.message, normalized.details);
};
