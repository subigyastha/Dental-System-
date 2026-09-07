import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AuthService, type AuthSession } from "./auth.service";
import { IS_PUBLIC_ROUTE } from "./public-route.decorator";
import { readSessionCookie } from "./session-cookie";

type RequestWithSession = {
  headers: { authorization?: string | string[]; cookie?: string | string[] };
  method?: string;
  originalUrl?: string;
  requestId?: string;
  authSession?: AuthSession;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;

    try {
      const cookieToken = readSessionCookie(request.headers.cookie);
      request.authSession = cookieToken
        ? await this.auth.sessionFromToken(cookieToken)
        : await this.auth.requireSession(authorization);
      return true;
    } catch (error) {
      this.logger.warn({
        event: "authorization_denied",
        method: request.method,
        path: request.originalUrl,
        requestId: request.requestId,
      });
      throw error;
    }
  }
}
