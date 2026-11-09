import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { open, type FileHandle } from "node:fs/promises";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep, isAbsolute } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";

export interface MediaGrant {
  url: string;
  fileId: string;
  expiresAt: string;
  mimeType: string;
  size: number;
  fileName: string;
  revoke(): void;
}

export interface MediaHostOptions {
  roots: string[];
  host?: string;
  advertiseHost?: string;
  port?: number;
  defaultTtlMs?: number;
  maxTtlMs?: number;
}

interface GrantRecord {
  tokenHash: Buffer;
  fileId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  expiresAt: number;
}

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".wav": "audio/wav", ".m3u8": "application/vnd.apple.mpegurl", ".mpd": "application/dash+xml",
  ".vtt": "text/vtt", ".srt": "application/x-subrip", ".ass": "text/x-ssa"
};

function contentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!value) return null;
  // Deliberately support one byte range only. Multipart ranges are not needed for media seeking.
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || value.includes(",")) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export class LocalMediaHost {
  private readonly server: Server;
  private readonly grants = new Map<string, GrantRecord>();
  private readonly roots: string[];
  private readonly defaultTtlMs: number;
  private readonly maxTtlMs: number;
  private listeningAddress: { host: string; port: number } | null = null;

  private constructor(private readonly options: MediaHostOptions, roots: string[]) {
    this.roots = roots;
    this.defaultTtlMs = options.defaultTtlMs ?? 15 * 60 * 1000;
    this.maxTtlMs = options.maxTtlMs ?? 60 * 60 * 1000;
    this.server = createServer((req, res) => { void this.handle(req, res); });
  }

  static async create(options: MediaHostOptions): Promise<LocalMediaHost> {
    if (!options.roots.length) throw new Error("At least one approved media root is required.");
    const roots = await Promise.all(options.roots.map(async root => {
      const resolved = await realpath(resolve(root));
      const info = await stat(resolved);
      if (!info.isDirectory()) throw new Error(`Media root is not a directory: ${root}`);
      return resolved;
    }));
    return new LocalMediaHost(options, roots);
  }

  async listen(): Promise<{ host: string; port: number }> {
    if (this.listeningAddress) return this.listeningAddress;
    const host = this.options.host ?? "0.0.0.0";
    const port = this.options.port ?? 8766;
    await new Promise<void>((resolveListen, reject) => {
      const onError = (error: Error) => { this.server.off("listening", onListen); reject(error); };
      const onListen = () => { this.server.off("error", onError); resolveListen(); };
      this.server.once("error", onError);
      this.server.once("listening", onListen);
      this.server.listen(port, host);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine media host address.");
    this.listeningAddress = { host, port: address.port };
    return this.listeningAddress;
  }

  async grantFile(filePath: string, ttlMs = this.defaultTtlMs): Promise<MediaGrant> {
    if (!this.listeningAddress) throw new Error("Call listen() before granting media files.");
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > this.maxTtlMs) throw new Error(`ttlMs must be between 1 and ${this.maxTtlMs}.`);
    const resolvedFile = await realpath(resolve(filePath));
    const root = this.roots.find(candidate => isWithin(candidate, resolvedFile));
    if (!root) throw new Error("File is outside the configured media roots.");
    const info = await stat(resolvedFile);
    if (!info.isFile()) throw new Error("Only regular files can be shared.");

    const token = randomBytes(32).toString("base64url");
    const fileId = randomUUID();
    // Store a digest, not the bearer token itself.
    const tokenHash = createHash("sha256").update(token).digest();
    const record: GrantRecord = {
      tokenHash, fileId, filePath: resolvedFile, fileName: basename(resolvedFile),
      mimeType: contentType(resolvedFile), size: info.size, expiresAt: Date.now() + ttlMs
    };
    this.grants.set(fileId, record);
    const url = `http://${this.publicHost()}:${this.listeningAddress.port}/media/${token}/${fileId}`;
    let revoked = false;
    return {
      url, fileId, expiresAt: new Date(record.expiresAt).toISOString(), mimeType: record.mimeType,
      size: record.size, fileName: record.fileName,
      revoke: () => { if (!revoked) { revoked = true; this.grants.delete(fileId); } }
    };
  }

  async close(): Promise<void> {
    this.grants.clear();
    if (!this.server.listening) return;
    await new Promise<void>((resolveClose, reject) => this.server.close(error => error ? reject(error) : resolveClose()));
    this.listeningAddress = null;
  }

  private publicHost(): string {
    if (this.options.advertiseHost) return this.options.advertiseHost;
    const configured = this.options.host ?? "0.0.0.0";
    if (configured !== "0.0.0.0" && configured !== "::") return configured;
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (!entry.internal && entry.family === "IPv4") return entry.address;
      }
    }
    return "127.0.0.1";
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestPath = new URL(req.url ?? "/", "http://localhost").pathname
      .replace(/^\/media\/[^/]+/, "/media/[redacted]");

    const startedAt = Date.now();
    let transferredBytes = 0;

    res.on("finish", () => {
      console.log(
        `[media-host] ${req.method} ${requestPath}` +
        ` status=${res.statusCode}` +
        ` range=${req.headers.range ?? "none"}` +
        ` bytes=${transferredBytes}` +
        ` duration=${Date.now() - startedAt}ms` +
        ` ua="${(req.headers["user-agent"] ?? "unknown").slice(0, 120)}"`
      );
    });
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const match = /^\/media\/([A-Za-z0-9_-]{43})\/([0-9a-f-]{36})$/.exec(pathname);

    if (!match) {
      console.log("[media-host] 404 reason=invalid-route");
      res.writeHead(404).end();
      return;
    }

    const [, token, fileId] = match;
    const grant = this.grants.get(fileId);

    if (!grant) {
      console.log("[media-host] 404 reason=grant-not-found");
      res.writeHead(404).end();
      return;
    }

    if (grant.expiresAt <= Date.now()) {
      console.log("[media-host] 404 reason=grant-expired");
      this.grants.delete(fileId);
      res.writeHead(404).end();
      return;
    }

    const supplied = createHash("sha256").update(token).digest();

    if (supplied.length !== grant.tokenHash.length ||
        !timingSafeEqual(supplied, grant.tokenHash)) {
      console.log("[media-host] 404 reason=token-mismatch");
      res.writeHead(404).end();
      return;
    }

    // Each HTTP request owns its own descriptor. Do not retain or share a raw
    // file descriptor across VLC's concurrent, interrupted, or retried requests.
    let requestHandle: FileHandle;
    let current;
    try {
      requestHandle = await open(grant.filePath, "r");
      current = await requestHandle.stat();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
      console.error(
        `[media-host] 404 reason=file-open-or-stat-failed code=${code} detail="${detail}"`
      );
      this.grants.delete(fileId);
      res.writeHead(404).end();
      return;
    }

    if (!current.isFile() || current.size !== grant.size) {
      await requestHandle.close().catch(() => undefined);
      this.grants.delete(fileId);
      res.writeHead(410).end();
      return;
    }

    const range = parseRange(req.headers.range, grant.size);
    if (range === "invalid") {
      await requestHandle.close().catch(() => undefined);
      res.writeHead(416, { "Content-Range": `bytes */${grant.size}`, "Accept-Ranges": "bytes" }).end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? grant.size - 1;
    const length = Math.max(0, end - start + 1);
    const headers: Record<string, string | number> = {
      "Content-Type": grant.mimeType, "Content-Length": length, "Accept-Ranges": "bytes",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(grant.fileName)}`
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${grant.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD" || length === 0) {
      await requestHandle.close().catch(() => undefined);
      res.end();
      return;
    }

    // FileHandle.createReadStream owns this request's descriptor and closes it
    // automatically when the response completes or the client disconnects.
    const stream = requestHandle.createReadStream({ start, end, autoClose: true });
    stream.on("data", (chunk: string | Buffer) => {
      transferredBytes += typeof chunk === "string"
        ? Buffer.byteLength(chunk)
        : chunk.byteLength;
    });
    stream.on("error", error => {
      console.error("[media-host] stream error:", error);
      if (!res.headersSent) res.writeHead(500);
      res.destroy();
    });
    res.on("close", () => {
      if (!res.writableEnded) stream.destroy();
    });
    stream.pipe(res);
  }
}

/** Resolve every A/AAAA answer and reject names that resolve to non-public addresses.
 * Call this immediately before fetching a genuinely remote URL and repeat it after each redirect.
 * Local sender-hosted URLs are intentionally handled separately and may use private LAN addresses.
 */
export async function assertPublicRemoteUrl(input: string): Promise<URL> {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Remote media URLs must use HTTP(S) without embedded credentials.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local hostnames are not allowed as remote media URLs.");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Remote media host resolves to a non-public address.");
  return url;
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51) ||
      (a === 203 && b === 0));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("2001:db8:") ||
        normalized.startsWith("2001:10:") || normalized.startsWith("2001:20:")) return false;
    // Only global-unicast 2000::/3 addresses are eligible. This excludes unspecified,
    // loopback, link-local, unique-local, multicast and most special-purpose ranges.
    const groups = normalized.split("::");
    const left = groups[0] ? groups[0].split(":") : [];
    const right = groups.length > 1 && groups[1] ? groups[1].split(":") : [];
    const expanded = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
    const first = Number.parseInt(expanded[0] ?? "0", 16);
    return first >= 0x2000 && first <= 0x3fff;
  }
  return false;
}
