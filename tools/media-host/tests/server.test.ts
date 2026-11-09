import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalMediaHost, assertPublicRemoteUrl } from "../src/server.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ucp-media-host-"));
  const mediaDir = join(root, "media");
  await mkdir(mediaDir);
  const file = join(mediaDir, "sample.mp4");
  await writeFile(file, Buffer.from("0123456789abcdef"));
  const host = await LocalMediaHost.create({ roots: [mediaDir], host: "127.0.0.1", port: 0, defaultTtlMs: 60_000, maxTtlMs: 120_000 });
  const address = await host.listen();
  return { root, mediaDir, file, host, base: `http://127.0.0.1:${address.port}` };
}

test("serves approved media with correct MIME and byte-range semantics", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file);
  const full = await fetch(grant.url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(Buffer.from(await full.arrayBuffer()).toString(), "0123456789abcdef");
  const partial = await fetch(grant.url, { headers: { Range: "bytes=4-8" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 4-8/16");
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), "45678");
});

test("supports suffix ranges, open-ended ranges and HEAD", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file);
  const suffix = await fetch(grant.url, { headers: { Range: "bytes=-4" } });
  assert.equal(suffix.status, 206); assert.equal(await suffix.text(), "cdef");
  const open = await fetch(grant.url, { headers: { Range: "bytes=12-" } });
  assert.equal(open.status, 206); assert.equal(await open.text(), "cdef");
  const head = await fetch(grant.url, { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), "16");
});

test("rejects unknown tokens and revoked grants", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file, 60_000);
  assert.equal((await fetch(`${f.base}/media/${"a".repeat(43)}/${grant.fileId}`)).status, 404);
  assert.equal((await fetch(`${f.base}/media/${"a".repeat(43)}/${grant.fileId}`, { method: "POST" })).status, 405);
  grant.revoke();
  assert.equal((await fetch(grant.url)).status, 404);
});

test("expires temporary bearer grants", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file, 20);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal((await fetch(grant.url)).status, 404);
});

test("rejects files outside approved roots and directories", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const outside = join(f.root, "outside.mp4"); await writeFile(outside, "outside");
  await assert.rejects(() => f.host.grantFile(outside), /outside the configured media roots/);
  await assert.rejects(() => f.host.grantFile(f.mediaDir), /Only regular files/);
});

test("returns 416 for invalid and multiple ranges", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file);
  const invalid = await fetch(grant.url, { headers: { Range: "bytes=99-100" } });
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get("content-range"), "bytes */16");
  const multiple = await fetch(grant.url, { headers: { Range: "bytes=0-1,4-5" } });
  assert.equal(multiple.status, 416);
});

test("enforces TTL limits", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  await assert.rejects(() => f.host.grantFile(f.file, 0), /ttlMs must be/);
  await assert.rejects(() => f.host.grantFile(f.file, 180_000), /ttlMs must be/);
});

test("remote URL guard accepts public hosts and rejects local/private destinations", async () => {
  const url = await assertPublicRemoteUrl("https://1.1.1.1/video.mp4");
  assert.equal(url.protocol, "https:");
  await assert.rejects(() => assertPublicRemoteUrl("http://127.0.0.1/video.mp4"), /non-public address/);
  await assert.rejects(() => assertPublicRemoteUrl("http://localhost/video.mp4"), /Local hostnames/);
  await assert.rejects(() => assertPublicRemoteUrl("file:///C:/video.mp4"), /HTTP\(S\)/);
});


test("serves concurrent byte ranges independently from the same grant", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const payload = Buffer.from(Array.from({ length: 256 }, (_, index) => index % 251));
  await writeFile(f.file, payload);
  // The grant captures file size at creation, so create it after writing the payload.
  const grant = await f.host.grantFile(f.file);

  const ranges = Array.from({ length: 16 }, (_, index) => {
    const start = index * 16;
    return { start, end: start + 15 };
  });
  const responses = await Promise.all(ranges.map(async ({ start, end }) => {
    const response = await fetch(grant.url, { headers: { Range: `bytes=${start}-${end}` } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/256`);
    return Buffer.from(await response.arrayBuffer());
  }));

  for (let index = 0; index < ranges.length; index++) {
    const { start, end } = ranges[index]!;
    assert.deepEqual(responses[index], payload.subarray(start, end + 1));
  }
});

test("a client can cancel a large transfer and the grant remains usable", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  // Large enough that the client can cancel while the response is still streaming.
  const payload = Buffer.alloc(16 * 1024 * 1024, 0x5a);
  await writeFile(f.file, payload);
  const grant = await f.host.grantFile(f.file);

  const interrupted = await fetch(grant.url);
  assert.equal(interrupted.status, 200);
  assert.ok(interrupted.body);
  const reader = interrupted.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(first.value && first.value.byteLength > 0);
  await reader.cancel();

  // A fresh request must still work after the previous response was aborted.
  const followUp = await fetch(grant.url, { headers: { Range: "bytes=0-1023" } });
  assert.equal(followUp.status, 206);
  assert.equal(followUp.headers.get("content-length"), "1024");
  const bytes = Buffer.from(await followUp.arrayBuffer());
  assert.equal(bytes.length, 1024);
  assert.ok(bytes.every(value => value === 0x5a));
});

test("revoking a grant blocks all subsequent requests", async t => {
  const f = await fixture(); t.after(async () => { await f.host.close(); await rm(f.root, { recursive: true, force: true }); });
  const grant = await f.host.grantFile(f.file);
  const before = await fetch(grant.url, { method: "HEAD" });
  assert.equal(before.status, 200);

  grant.revoke();
  assert.equal((await fetch(grant.url)).status, 404);
  assert.equal((await fetch(grant.url, { method: "HEAD" })).status, 404);
});
