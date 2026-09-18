import { execFileSync } from "node:child_process";

let cached: string | null = null;

/** The running build: xhostd's XHOST_SHA (short), else the checkout's git sha, else "dev". */
export function appVersion(): string {
  if (cached) return cached;
  const fromEnv = (process.env.XHOST_SHA ?? process.env.GIT_SHA)?.trim();
  if (fromEnv) return (cached = fromEnv.slice(0, 7));
  try {
    cached = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim() || "dev";
  } catch {
    cached = "dev";
  }
  return cached;
}
