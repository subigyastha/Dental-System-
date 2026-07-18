import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AuthService, type AuthSession } from "./auth.service";
import { IS_PUBLIC_ROUTE } from "./public-route.decorator";

type RequestWithSession = {
  headers: { authorization?: string | string[] };
  method?: string;
  originalUrl?: string;
  requestId?: string;
  authSession?: AuthSession;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
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
      request.authSession = await this.auth.requireSession(authorization);
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
