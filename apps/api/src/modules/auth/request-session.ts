import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import type { AuthSession } from "./auth.service";

export type RequestWithAuthSession = {
  authSession?: AuthSession;
};

/**
 * The guard attaches `authSession` only after it has validated a cookie or
 * bearer token. Controllers use that server-derived object for cookie
 * requests; the header is retained solely for the temporary bearer bridge.
 *
 * Existing domain-service parameters are still typed as `string` during the
 * bridge. At runtime this can be an AuthSession, which AuthService resolves
 * without re-parsing a header. This helper is the only permitted cast point.
 */
export function sessionForService(
  request: RequestWithAuthSession,
  authorization?: string,
): string {
  return (request.authSession ?? authorization) as unknown as string;
}

/**
 * Supplies the guard-attached session to legacy controller service calls. The
 * header fallback is temporary and is removed with bearer compatibility.
 */
export const ServiceSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<
      RequestWithAuthSession & { headers?: { authorization?: string | string[] } }
    >();
    const header = request.headers?.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    return sessionForService(request, authorization);
  },
);
