/**
 * Tool arguments: a small JSON Schema subset that is both what tools/list advertises
 * and what tools/call enforces, so the two cannot drift apart.
 */

export type Field =
  | { type: "string"; description: string; enum?: readonly string[]; maxLength?: number; pattern?: RegExp; format?: "date" }
  | { type: "integer"; description: string; minimum: number; maximum: number; default?: number }
  | { type: "boolean"; description: string; default?: boolean };

export type Fields = Record<string, Field>;
export type ArgValue = string | number | boolean | undefined;

export class ArgError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function inputSchema(fields: Fields, required: readonly string[] = []) {
  const properties: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(fields)) {
    const { pattern, ...rest } = f as Field & { pattern?: RegExp };
    properties[name] = { ...rest, ...(pattern ? { pattern: pattern.source } : {}) };
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** The validated arguments, defaults filled in. Throws ArgError with a message meant for the model. */
export function parseArgs(fields: Fields, required: readonly string[], raw: unknown): Record<string, ArgValue> {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) throw new ArgError("arguments must be an object");
  const input = (raw ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(input)) if (!(name in fields)) throw new ArgError(`unknown argument: ${name}`);

  const out: Record<string, ArgValue> = {};
  for (const [name, f] of Object.entries(fields)) {
    let value = input[name];
    if (value === null || value === "") value = undefined;
    if (value === undefined) {
      if (required.includes(name)) throw new ArgError(`${name} is required`);
      out[name] = "default" in f ? f.default : undefined;
      continue;
    }
    if (f.type === "string") {
      if (typeof value !== "string") throw new ArgError(`${name} must be a string`);
      const v = value.trim();
      if (v.length > (f.maxLength ?? 200)) throw new ArgError(`${name} is longer than ${f.maxLength ?? 200} characters`);
      if (f.enum && !f.enum.includes(v)) throw new ArgError(`${name} must be one of: ${f.enum.join(", ")}`);
      if (f.pattern && !f.pattern.test(v)) throw new ArgError(`${name} has an invalid format`);
      if (f.format === "date" && !(DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v))) {
        throw new ArgError(`${name} must be a date, YYYY-MM-DD`);
      }
      out[name] = v || undefined;
    } else if (f.type === "integer") {
      const n = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) throw new ArgError(`${name} must be a whole number`);
      if (n < f.minimum || n > f.maximum) throw new ArgError(`${name} must be between ${f.minimum} and ${f.maximum}`);
      out[name] = n;
    } else {
      const b = value === "true" ? true : value === "false" ? false : value;
      if (typeof b !== "boolean") throw new ArgError(`${name} must be true or false`);
      out[name] = b;
    }
  }
  return out;
}
