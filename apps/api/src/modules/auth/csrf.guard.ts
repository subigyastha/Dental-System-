import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AuthService } from "./auth.service";
import { IS_PUBLIC_ROUTE } from "./public-route.decorator";
import { readSessionCookie } from "./session-cookie";

type RequestWithCookies = {
  method?: string;
  headers: {
    cookie?: string | string[];
    "x-csrf-token"?: string | string[];
  };
};

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCookies>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method ?? "GET")) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const sessionToken = readSessionCookie(request.headers.cookie);
    if (!sessionToken) {
      // Temporary non-browser bearer callers remain compatible during the
      // cookie transport cutover. Browser requests always supply the cookie.
      return true;
    }

    const csrfHeader = request.headers["x-csrf-token"];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    await this.auth.assertCsrfToken(sessionToken, csrfToken);
    return true;
  }
}
