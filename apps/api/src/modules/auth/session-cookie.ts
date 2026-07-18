import { SESSION_COOKIE_NAME } from "./auth.service";

export function readSessionCookie(cookieHeader?: string | string[]) {
  const value = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (!value) {
    return undefined;
  }

  for (const part of value.split(";")) {
    const [name, ...encodedValue] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(encodedValue.join("="));
    }
  }

  return undefined;
}
