import { createServer } from "node:http";
import { Bonjour } from "bonjour-service";
import { WebSocketServer } from "ws";
import { createProtocolConnection } from "./protocol.js";
import { SessionManager } from "./sessions.js";

const serviceName = process.env.UCP_DEVICE_NAME ?? "UniversalCast Windows Simulator";
const host = process.env.UCP_HOST ?? "0.0.0.0";
const port = Number(process.env.UCP_PORT ?? 8765);
const path = "/ucp";
const sessions = new SessionManager();
const connections = new Map<import("ws").WebSocket, ReturnType<typeof createProtocolConnection>>();
const pendingStateChanges: Array<{ sessionId: string; snapshot: unknown }> = [];
let eventFlushScheduled = false;
sessions.subscribe(change => {
  pendingStateChanges.push(change);
  if (eventFlushScheduled) return;
  eventFlushScheduled = true;
  // Flush after the current request handler sends its correlated response. This keeps
  // outgoing sequence order identical to wire order (response first, then state event).
  queueMicrotask(() => {
    eventFlushScheduled = false;
    const changes = pendingStateChanges.splice(0);
    for (const [client, protocol] of connections) {
      if (client.readyState !== client.OPEN) continue;
      for (const change of changes) {
        const event = protocol.eventForSession(change.sessionId, "state.changed", { snapshot: change.snapshot });
        if (event) client.send(JSON.stringify(event));
      }
    }
  });
});

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("UCP_PORT must be an integer between 1024 and 65535.");
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: serviceName, protocol: "UCP", version: "1.0" }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
httpServer.on("upgrade", (request, socket, head) => {
  if (request.url !== path) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
});

wss.on("connection", ws => {
  const protocol = createProtocolConnection({ deviceName: serviceName, sessions });
  connections.set(ws, protocol);
  console.log("[ws] client connected");
  ws.on("message", (raw: { toString(): string }) => {
    try {
      for (const response of protocol.handle(raw.toString())) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(response));
      }
    } catch (error) {
      console.error("[protocol] unexpected handler error:", error);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, "Internal protocol error");
      }
    }
  });
  ws.on("close", () => { connections.delete(ws); protocol.disconnect(); console.log("[ws] client disconnected"); });
});

const bonjour = new Bonjour();
httpServer.listen(port, host, () => {
  console.log(`[receiver] ${serviceName}`);
  console.log(`[receiver] HTTP health: http://127.0.0.1:${port}/health`);
  console.log(`[receiver] WebSocket: ws://<host>:${port}${path}`);
  console.log("[receiver] DEVELOPMENT ONLY: no pairing/authentication; do not expose to untrusted networks.");
  bonjour.publish({
    name: serviceName, type: "universalcast", protocol: "tcp", port,
    txt: { ucp: "1.0", id: "simulator-" + process.pid, path, tls: "0", mode: "development" }
  });
  console.log("[mdns] advertising _universalcast._tcp.local.");
});

function shutdown() {
  console.log("\n[receiver] shutting down");
  bonjour.unpublishAll();
  bonjour.destroy();
  wss.clients.forEach(client => client.close(1001, "Server shutting down"));
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
