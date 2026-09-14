// xhostd mounts its sign-in on every hostname; return_to must be a relative path.
export const XHOST_COOKIE = "__Host-xhost_id";

export function loginUrl(returnTo = "/"): string {
  return `/xhost-auth/login?return_to=${encodeURIComponent(safePath(returnTo))}`;
}

export function logoutUrl(returnTo = "/"): string {
  return `/xhost-auth/logout?return_to=${encodeURIComponent(safePath(returnTo))}`;
}

function safePath(path: string): string {
  // Only same-site paths: "//evil.com", "/\evil.com" (a browser reads "\" as "/"), absolute URLs
  // and control characters all collapse to "/".
  return /^\/(?![\/\\])[^\\\x00-\x1f]*$/.test(path) ? path : "/";
}
