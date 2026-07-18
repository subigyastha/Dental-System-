import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ROUTE = "isPublicRoute";

/**
 * Marks the deliberately small set of routes that may be called without a
 * staff session. All other controller actions are protected by the global
 * session guard.
 */
export const PublicRoute = () => SetMetadata(IS_PUBLIC_ROUTE, true);
