/**
 * Runs once when the server starts (Next instrumentation). Server errors that escape a page or a
 * route are printed by Next to the console as they are; a database or Salesforce error's message
 * can carry personal data (what was searched, an address). Every console.error argument goes
 * through redactForConsole first, so such an error is printed as its code only.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { redactForConsole } = await import("@/lib/log");
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => original(...args.map(redactForConsole));
}
