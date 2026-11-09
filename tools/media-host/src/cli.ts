import { resolve } from "node:path";
import { LocalMediaHost } from "./server.js";

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const file = arg("--file");
const root = arg("--root");
if (!file || !root) {
  console.error('Usage: pnpm --filter @universalcast/media-host dev -- --root "C:\\Media" --file "C:\\Media\\video.mp4" [--host 0.0.0.0] [--advertise-host 192.168.x.x] [--port 8766] [--ttl-minutes 15]');
  process.exit(2);
}
const host = arg("--host") ?? "0.0.0.0";
const advertiseHost = arg("--advertise-host");
const port = Number(arg("--port") ?? 8766);
const ttlMinutes = Number(arg("--ttl-minutes") ?? 15);
const mediaHost = await LocalMediaHost.create({ roots: [resolve(root)], host, ...(advertiseHost ? { advertiseHost } : {}), port });
const address = await mediaHost.listen();
const grant = await mediaHost.grantFile(resolve(file), ttlMinutes * 60_000);
console.log("UniversalCast temporary media host (development)");
console.log(`Listening: ${host}:${address.port}`);
console.log(`File: ${grant.fileName}`);
console.log(`MIME: ${grant.mimeType}`);
console.log(`Size: ${grant.size} bytes`);
console.log(`Expires: ${grant.expiresAt}`);
console.log(`Media URL: ${grant.url}`);
console.log("Share this URL only with the intended receiver. HTTP is not encrypted; use trusted LANs only.");
const shutdown = async () => { grant.revoke(); await mediaHost.close(); process.exit(0); };
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
