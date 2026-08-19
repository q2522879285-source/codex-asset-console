import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceGovernance } from "../asset-browser/workspace-governance.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-governance-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const activeRoot = path.join(root, "active");
  const moduleRoot = path.join(root, "runtime");
  const archiveRoot = path.join(root, "archive");
  const ownedCache = path.join(root, "owned-cache");
  const foreignCache = path.join(root, "foreign-cache");
  await Promise.all([activeRoot, moduleRoot, archiveRoot, ownedCache, foreignCache].map((item) => fs.mkdir(item, { recursive: true })));
  const statePath = path.join(activeRoot, "state.json");
  const frontendPath = path.join(moduleRoot, "app.js");
  const backendPath = path.join(moduleRoot, "server.js");
  await fs.writeFile(statePath, "state-v1\n");
  await fs.writeFile(frontendPath, "frontend-v1\n");
  await fs.writeFile(backendPath, "backend-v1\n");
  await fs.writeFile(path.join(archiveRoot, "master.mov"), "archive-original\n");
  await fs.writeFile(path.join(ownedCache, "thumb.bin"), "cache\n");
  await fs.writeFile(path.join(foreignCache, "private.bin"), "foreign\n");
  const governance = new WorkspaceGovernance({
    root: path.join(root, "governance"),
    stateFiles: [{ id: "state", label: "活动状态", component: "state", path: statePath }],
    moduleFiles: [
      { id: "ui", label: "界面", component: "frontend", path: frontendPath },
      { id: "server", label: "服务", component: "backend", path: backendPath }
    ],
    cacheRoots: [
      { id: "owned", label: "拥有的缓存", path: ownedCache, owned: true },
      { id: "foreign", label: "外部目录", path: foreignCache, owned: false }
    ]
  });
  return { root, governance, statePath, frontendPath, backendPath, archiveRoot, ownedCache, foreignCache };
}

test("four tiers report state without reading archive contents", async (t) => {
  const f = await fixture(t);
  const status = await f.governance.status({ archives: [{ id: "project", label: "项目", path: f.archiveRoot }] });
  assert.equal(status.tiers.active.items[0].exists, true);
  assert.equal(status.tiers.archive.items[0].protected, true);
  assert.equal(status.tiers.system.modules.length, 2);
  assert.ok(status.tiers.cache.bytes > 0);
});

test("snapshot and state restore never duplicate or modify project assets", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.governance.createSnapshot({ label: "完整恢复点", includeModules: true });
  assert.equal(snapshot.files.filter((item) => item.tier === "active").length, 1);
  assert.equal(snapshot.files.filter((item) => item.tier === "system").length, 2);
  assert.equal(snapshot.files.some((item) => item.originalPath.startsWith(f.archiveRoot)), false);
  await fs.writeFile(f.statePath, "state-v2\n");
  const result = await f.governance.restoreSnapshot(snapshot.id);
  assert.equal(await fs.readFile(f.statePath, "utf8"), "state-v1\n");
  assert.ok(result.safetySnapshotId);
  assert.equal(await fs.readFile(path.join(f.archiveRoot, "master.mov"), "utf8"), "archive-original\n");
});

test("module rollback is component scoped and preserves a safety version", async (t) => {
  const f = await fixture(t);
  const baseline = await f.governance.createSnapshot({ label: "v1", includeModules: true });
  await fs.writeFile(f.frontendPath, "frontend-v2\n");
  await fs.writeFile(f.backendPath, "backend-v2\n");
  const result = await f.governance.restoreModules(baseline.id, { components: ["frontend"] });
  assert.deepEqual(result.restored, ["ui"]);
  assert.equal(await fs.readFile(f.frontendPath, "utf8"), "frontend-v1\n");
  assert.equal(await fs.readFile(f.backendPath, "utf8"), "backend-v2\n");
  assert.ok(result.safetySnapshotId);
  assert.equal(result.restartRequired, false);
});

test("release baseline is content-addressed and not duplicated", async (t) => {
  const f = await fixture(t);
  const first = await f.governance.ensureReleaseBaseline("release");
  const second = await f.governance.ensureReleaseBaseline("release");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.snapshot.id, second.snapshot.id);
  await fs.writeFile(f.backendPath, "backend-v2\n");
  const third = await f.governance.ensureReleaseBaseline("release 2");
  assert.equal(third.created, true);
  assert.notEqual(third.snapshot.moduleFingerprint, first.snapshot.moduleFingerprint);
});

test("cache clearing is allowlisted and leaves active, archive and foreign data untouched", async (t) => {
  const f = await fixture(t);
  const result = await f.governance.clearCaches();
  assert.equal(result.cleared.some((item) => item.id === "owned"), true);
  assert.equal(await fs.readdir(f.ownedCache).then((items) => items.length), 0);
  assert.equal(await fs.readFile(path.join(f.foreignCache, "private.bin"), "utf8"), "foreign\n");
  assert.equal(await fs.readFile(f.statePath, "utf8"), "state-v1\n");
  assert.equal(await fs.readFile(path.join(f.archiveRoot, "master.mov"), "utf8"), "archive-original\n");
});

test("automatic cache cleanup applies age and capacity limits only to owned cache roots", async (t) => {
  const f = await fixture(t);
  await fs.rm(f.ownedCache, { recursive: true, force: true });
  await fs.mkdir(path.join(f.ownedCache, "nested"), { recursive: true });
  const expired = path.join(f.ownedCache, "expired.bin");
  const older = path.join(f.ownedCache, "nested", "older.bin");
  const latest = path.join(f.ownedCache, "latest.bin");
  await Promise.all([
    fs.writeFile(expired, "old!"),
    fs.writeFile(older, "keep"),
    fs.writeFile(latest, "new!")
  ]);
  const now = Date.now();
  await fs.utimes(expired, new Date(now - 10 * 86400000), new Date(now - 10 * 86400000));
  await fs.utimes(older, new Date(now - 2 * 86400000), new Date(now - 2 * 86400000));
  await fs.utimes(latest, new Date(now - 1 * 86400000), new Date(now - 1 * 86400000));
  await f.governance.initialize();
  await fs.writeFile(path.join(f.root, "governance", "policies.json"), JSON.stringify({
    tiers: { cache: { autoCleanup: true, maxAgeDays: 7, maxBytes: 4 } }
  }));

  const result = await f.governance.autoCleanupCaches({ now });
  assert.equal(result.removedFiles, 2);
  assert.deepEqual(result.reasons, { expired: 1, capacity: 1 });
  assert.equal(await fs.readFile(latest, "utf8"), "new!");
  await assert.rejects(() => fs.access(expired));
  await assert.rejects(() => fs.access(older));
  assert.equal(await fs.readFile(path.join(f.foreignCache, "private.bin"), "utf8"), "foreign\n");
  assert.equal(await fs.readFile(f.statePath, "utf8"), "state-v1\n");
  assert.equal(await fs.readFile(path.join(f.archiveRoot, "master.mov"), "utf8"), "archive-original\n");
});

test("corrupted recovery files fail closed", async (t) => {
  const f = await fixture(t);
  const snapshot = await f.governance.createSnapshot({ label: "before" });
  const item = snapshot.files.find((entry) => entry.id === "state");
  const snapshotFile = path.join(f.root, "governance", "snapshots", snapshot.id, item.storedPath);
  await fs.writeFile(snapshotFile, "tampered\n");
  await fs.writeFile(f.statePath, "state-v2\n");
  await assert.rejects(() => f.governance.restoreSnapshot(snapshot.id), /已损坏/);
  assert.equal(await fs.readFile(f.statePath, "utf8"), "state-v2\n");
});

test("concurrent recovery point creation is serialized", async (t) => {
  const f = await fixture(t);
  const snapshots = await Promise.all(Array.from({ length: 6 }, (_, index) => f.governance.createSnapshot({ label: `s${index}` })));
  assert.equal(new Set(snapshots.map((item) => item.id)).size, 6);
  assert.equal((await f.governance.listSnapshots()).length, 6);
});

test("UI and server expose governance controls with explicit confirmation", async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const [html, app, server] = await Promise.all([
    fs.readFile(path.join(repo, "asset-console", "public", "index.html"), "utf8"),
    fs.readFile(path.join(repo, "asset-console", "public", "app.js"), "utf8"),
    fs.readFile(path.join(repo, "asset-browser", "server.js"), "utf8")
  ]);
  assert.match(html, /id="governanceDialog"/);
  assert.match(html, /不复制项目素材/);
  assert.match(app, /includeModules: true/);
  assert.match(app, /回滚界面/);
  assert.match(app, /回滚后端/);
  assert.match(server, /workspace-governance\/modules\/restore/);
  assert.match(server, /setInterval\(runWorkspaceCacheCleanup, 6 \* 60 \* 60 \* 1000\)/);
  assert.match(server, /body\.confirm !== true/);
  assert.doesNotMatch(server.match(/function mutationSummary[\s\S]*?\n}/)?.[0] || "", /["'](?:prompt|content|body)["']/i);
});
