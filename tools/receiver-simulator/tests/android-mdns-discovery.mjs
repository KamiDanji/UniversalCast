import { Bonjour } from "bonjour-service";

const timeoutMs = Number(process.env.UCP_DISCOVERY_TIMEOUT_MS ?? 15000);
const expectedName = process.env.UCP_ANDROID_DEVICE_NAME ?? "UniversalCast Android TV";
const expectedPort = Number(process.env.UCP_PORT ?? 8765);
const expectedPath = "/ucp";

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
  throw new Error("UCP_DISCOVERY_TIMEOUT_MS must be between 1000 and 120000.");
}

const bonjour = new Bonjour();
const browser = bonjour.find({ type: "universalcast", protocol: "tcp" });
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  browser.stop();
  bonjour.destroy();
  console.log(message);
  process.exitCode = code;
}

const timer = setTimeout(() => {
  finish(1, `FAIL: Did not discover "${expectedName}" as _universalcast._tcp.local. within ${timeoutMs}ms.`);
}, timeoutMs);

browser.on("up", service => {
  if ((service.txt ?? {}).name !== expectedName) return;

  const txt = service.txt ?? {};
  const checks = [
    ["service port", service.port === expectedPort, `${service.port} (expected ${expectedPort})`],
    ["UCP version", txt.ucp === "1.0", `${txt.ucp ?? "<missing>"} (expected 1.0)`],
    ["control path", txt.path === expectedPath, `${txt.path ?? "<missing>"} (expected ${expectedPath})`],
    ["TLS hint", txt.tls === "0", `${txt.tls ?? "<missing>"} (expected 0 for M2.2 dev endpoint)`],
    ["mode hint", txt.mode === "development", `${txt.mode ?? "<missing>"} (expected development)`],
    ["advertised name", txt.name === expectedName, `${txt.name ?? "<missing>"} (expected ${expectedName})`],
    ["device ID", typeof txt.id === "string" && txt.id.length > 0, `${txt.id ?? "<missing>"}`],
    ["resolved host", typeof service.host === "string" && service.host.length > 0, `${service.host ?? "<missing>"}`],
    ["resolved address", Array.isArray(service.addresses) && service.addresses.length > 0, `${(service.addresses ?? []).join(", ") || "<missing>"}`]
  ];

  let failed = false;
  for (const [label, passed, detail] of checks) {
    console.log(`${passed ? "PASS" : "FAIL"} ${label}: ${detail}`);
    if (!passed) failed = true;
  }

  finish(failed ? 1 : 0, failed
    ? "Android mDNS discovery test: FAILED."
    : "Android mDNS discovery test: all checks passed.");
});
