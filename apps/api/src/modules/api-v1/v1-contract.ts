import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from "@nestjs/common";

export const API_V1 = "v1" as const;

export type V1Meta = {
  apiVersion: typeof API_V1;
  requestId?: string;
};

export type V1Envelope<T> = {
  data: T;
  meta: V1Meta;
};

export function v1Envelope<T>(data: T, requestId?: string): V1Envelope<T> {
  return { data, meta: { apiVersion: API_V1, ...(requestId ? { requestId } : {}) } };
}

type V1ErrorBody = {
  error: {
    code: "validation_error" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "internal_error";
    message: string;
  };
  meta: V1Meta;
};

export function v1ErrorBody(exception: unknown, requestId?: string): { status: number; body: V1ErrorBody } {
  const status = exception instanceof HttpException ? exception.getStatus() : 500;
  const response = exception instanceof HttpException ? exception.getResponse() : undefined;
  const message = typeof response === "string"
    ? response
    : response && typeof response === "object" && "message" in response
      ? Array.isArray(response.message) ? "Request validation failed" : String(response.message)
      : "Internal server error";
  const codes: Record<number, V1ErrorBody["error"]["code"]> = {
    400: "validation_error",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    429: "rate_limited",
  };
  return {
    status,
    body: {
      error: { code: codes[status] ?? "internal_error", message: status >= 500 ? "Internal server error" : message },
      meta: { apiVersion: API_V1, ...(requestId ? { requestId } : {}) },
    },
  };
}

/** Controller-scoped so legacy endpoint response shapes remain unchanged. */
@Catch()
export class V1ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<{ requestId?: string }>();
    const result = v1ErrorBody(exception, request.requestId);
    http.getResponse<{ status(status: number): { json(body: V1ErrorBody): void } }>()
      .status(result.status)
      .json(result.body);
  }
}
