import { Bonjour } from "bonjour-service";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const hostArg = args.find(v => v.startsWith("--host="))?.slice(7);
const portArg = args.find(v => v.startsWith("--port="))?.slice(7);
const port = Number(portArg ?? 8765);
const bonjour = new Bonjour();
let stopped = false;
const discovered = new Set<string>();

function stop() {
  if (stopped) return;
  stopped = true;
  bonjour.destroy();
  process.exit(0);
}
process.on("SIGINT", stop);

function connect(host: string, targetPort: number, name: string) {
  const ws = new WebSocket(`ws://${host}:${targetPort}/ucp`);
  ws.on("open", () => {
    const hello = {
      protocol:"UCP", version:"1.0", type:"request", id:randomUUID(),
      sessionId:null, seq:1, sentAt:new Date().toISOString(),
      action:"connection.hello",
      payload:{ supportedVersions:["1.0"], client:{ name:"UCP CLI Sender", version:"0.1.0" } }
    };
    console.log(`[connect] connected to ${name} at ${host}:${targetPort}`);
    ws.send(JSON.stringify(hello));
  });
  ws.on("message", raw => {
    try { console.log("[message]", JSON.stringify(JSON.parse(raw.toString()), null, 2)); }
    catch { console.log("[message] non-JSON response"); }
    ws.close();
    stop();
  });
  ws.on("error", error => { console.error("[connect] failed:", error.message); stop(); });
  ws.on("close", () => console.log("[connect] connection closed"));
}

if (hostArg) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
  connect(hostArg, port, "manual receiver");
} else {
  console.log("[discovery] browsing _universalcast._tcp.local. (Ctrl+C to stop)");
  bonjour.find({ type:"universalcast", protocol:"tcp" }, service => {
    const key = service.fqdn;
    if (discovered.has(key)) return;
    discovered.add(key);
    const host = service.addresses?.find(a => a.includes(".")) ?? service.host;
    const record = { host, port:service.port, name:service.name, txt:service.txt ?? {} };
    console.log("[discovery] receiver found:");
    console.log(JSON.stringify(record, null, 2));
  });
}
