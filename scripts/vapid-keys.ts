/**
 * Generates a VAPID key pair for push notices (docs/pwa.md) and writes it to .secrets/vapid.env
 * (gitignored). Nothing is printed except the file's path: the private key goes to xhostd as a
 * secret (VAPID_PRIVATE_KEY, set_env secret=true) and nowhere else.
 *
 *   node --import tsx scripts/vapid-keys.ts [subject]      e.g. mailto:admin@example.com
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateVapidKeys } from "../src/lib/push/webpush";

const dir = join(process.cwd(), ".secrets");
const file = join(dir, "vapid.env");
if (existsSync(file)) {
  console.error(`${file} already exists; move it away first (replacing the keys signs every device out of push).`);
  process.exit(1);
}
const subject = process.argv[2] ?? "mailto:";
const { publicKey, privateKey } = generateVapidKeys();
mkdirSync(dir, { recursive: true });
writeFileSync(file, `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`, { mode: 0o600 });
console.log(`written: ${file}`);
