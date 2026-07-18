import { Body, Controller, Get, Headers, Inject, Post, Req, Res } from "@nestjs/common";

import { AuthService, type AuthSession, type SessionCookie } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { PublicRoute } from "./public-route.decorator";
import { readSessionCookie } from "./session-cookie";

type SessionRequest = {
  headers: { cookie?: string | string[]; "x-forwarded-for"?: string | string[]; "user-agent"?: string };
  ip?: string;
  authSession?: AuthSession;
};
type CookieResponse = {
  cookie(name: string, value: string, options: SessionCookie["options"]): void;
};

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  @Post("login")
  @PublicRoute()
  async login(
    @Body() dto: LoginDto,
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const forwardedFor = request.headers["x-forwarded-for"];
    const ipAddress = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim() ?? request.ip;
    const issued = await this.auth.login(dto, {
      ipAddress,
      userAgent: request.headers["user-agent"],
    });
    const cookie = this.auth.issueSessionCookie(issued.token, new Date(issued.session.expiresAt));
    response.cookie(cookie.name, cookie.value, cookie.options);
    return { user: issued.user, csrfToken: issued.csrfToken, session: issued.session };
  }

  @Get("me")
  me(@Req() request: SessionRequest) {
    return request.authSession;
  }

  @Get("csrf")
  async csrf(@Req() request: SessionRequest) {
    return {
      csrfToken: await this.auth.rotateCsrfTokenForSessionToken(
        readSessionCookie(request.headers.cookie),
      ),
    };
  }

  @Post("logout")
  async logout(
    @Req() request: SessionRequest,
    @Headers("x-csrf-token") csrfToken: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const sessionToken = readSessionCookie(request.headers.cookie);
    await this.auth.assertCsrfToken(sessionToken, csrfToken);
    await this.auth.logoutSessionToken(sessionToken);
    const cookie = this.auth.clearSessionCookie();
    response.cookie(cookie.name, cookie.value, cookie.options);
    return { ok: true };
  }
}
