import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MidjourneyWorkspace, parseMidjourneyFilename } from "../asset-browser/midjourney-workspace.js";

const mjName = "u9338597418__cinematic_city_--ar_169_--profile_eo8gh7c_--stylize_150_13cbf948-bcbd-4bb5-a5ed-c4e38988988f_1.png";

test("MJ 工作区只收录精确命名并以移动方式归档", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mj-workspace-"));
  const downloads = path.join(root, "Downloads");
  const generatedRoot = path.join(root, "Store");
  const registryPath = path.join(root, "state", "mj.json");
  await fs.mkdir(downloads, { recursive: true });
  await fs.writeFile(path.join(downloads, mjName), "mj-image");
  await fs.writeFile(path.join(downloads, "ordinary-family-photo.png"), "ordinary");

  try {
    const parsed = parseMidjourneyFilename(mjName);
    assert.equal(parsed.aspect, "16:9");
    assert.deepEqual(parsed.profiles, ["eo8gh7c"]);
    assert.equal(parseMidjourneyFilename("ordinary-family-photo.png"), null);

    const workspace = new MidjourneyWorkspace({ downloadsPath: downloads, registryPath });
    const candidates = await workspace.listCandidates();
    assert.deepEqual(candidates.map((item) => item.name), [mjName]);

    const [record] = await workspace.importFiles({
      names: [mjName],
      projectId: "p1",
      projectName: "测试项目",
      generatedRoot,
      targetRelativePath: "Midjourney"
    });
    assert.equal(await fs.readFile(path.join(downloads, "ordinary-family-photo.png"), "utf8"), "ordinary");
    await assert.rejects(fs.access(path.join(downloads, mjName)));
    assert.ok(path.resolve(record.storePath).startsWith(path.resolve(generatedRoot) + path.sep));
    assert.equal(await fs.readFile(record.storePath, "utf8"), "mj-image");
    assert.ok(JSON.parse(await fs.readFile(`${record.storePath}.mj.json`, "utf8")).sha256);

    const profile = await workspace.saveProfile({ code: "eo8gh7c", name: "冷峻电影感", rating: 4, tags: "电影光、冷色" });
    assert.equal(profile.rating, 4);
    assert.equal((await workspace.summary()).profiles.length, 1);
    await assert.rejects(() => workspace.importFiles({ names: ["../ordinary-family-photo.png"], generatedRoot }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
