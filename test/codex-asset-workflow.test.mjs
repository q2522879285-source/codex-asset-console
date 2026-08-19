import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const injectionPath = new URL("../inject/conversation-preview.user.js", import.meta.url);
const injectorPath = new URL("../scripts/injector.mjs", import.meta.url);
const embeddedIndexPath = new URL("../asset-console/public/index.html", import.meta.url);
const embeddedAppPath = new URL("../asset-console/public/app.js", import.meta.url);
const embeddedCssPath = new URL("../asset-console/public/ui-v3.css", import.meta.url);

function extractFunctionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\(`).exec(source);
  assert.ok(match, `${name} is present`);
  const start = match.index;
  const openingBrace = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test("Asset Console opens with the active Codex task context", async () => {
  const [injection, injector] = await Promise.all([
    readFile(injectionPath, "utf8"),
    readFile(injectorPath, "utf8"),
  ]);
  assert.match(injection, /currentCodexTaskContext/);
  assert.match(injection, /data-app-action-sidebar-thread-id/);
  assert.match(injector, /searchParams\.set\("embed", "codex"\)/);
  assert.match(injector, /searchParams\.set\("threadId", message\.threadId\)/);
  assert.match(injector, /searchParams\.set\("threadTitle", message\.threadTitle\)/);
});

test("assets are added to the composer without submitting the task", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /event\.source !== frame\.contentWindow/);
  assert.match(injection, /event\.origin !== "https:\/\/web-sandbox\.oaiusercontent\.com"/);
  assert.match(injection, /参考资产：\$\{assetPath\}/);
  assert.match(injection, /InputEvent\("input"/);
  assert.match(injection, /isAbsoluteWindowsAssetPath\(assetPath\)/);
  assert.doesNotMatch(injection, /handleAssetConsoleMessage[\s\S]{0,1800}(click\(\)|requestSubmit\(|submit\()/);
});

test("only absolute Windows asset paths cross the iframe-to-composer boundary", async () => {
  const injection = await readFile(injectionPath, "utf8");
  const source = injection.match(/function isAbsoluteWindowsAssetPath\(value\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source, "path validator is present in the parent renderer");
  const validate = new Function(`${source}; return isAbsoluteWindowsAssetPath;`)();
  for (const value of [
    "C:\\work\\asset.png",
    "C:/workspace/asset.mp4",
    "\\\\server\\share\\asset.mov",
    "//server/share/asset.mov",
  ]) assert.equal(validate(value), true, value);
  for (const value of [
    "relative\\asset.png",
    "C:relative\\asset.png",
    "\\root-relative.png",
    "https://example.com/asset.png",
    "",
  ]) assert.equal(validate(value), false, value);
});

test("an open Asset Console refreshes when the selected Codex task changes", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /function syncAssetConsoleTaskContext/);
  assert.match(injection, /panel\.dataset\.taskContextKey === nextKey/);
  assert.match(injection, /panel\.querySelector\(`#\$\{ASSET_CONSOLE_FRAME_ID\}`\)\?\.remove\(\)/);
  assert.match(injection, /function sync\(\) \{[\s\S]{0,180}syncAssetConsoleTaskContext\(\)/);
  assert.match(injection, /data-app-action-sidebar-thread-selected/);
});

test("the embedded Asset Console surface ships its task-integrated workspace", async () => {
  const [injector, html, app, css] = await Promise.all([
    readFile(injectorPath, "utf8"),
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(injector, /embeddedAssetConsoleResponse/);
  assert.match(injector, /path\.join\(root, "asset-console", "public"\)/);
  assert.match(html, /codex-task-bar/);
  assert.match(app, /sendAssetToCodex/);
  assert.match(app, /features: \{ midjourney: false \}/);
  assert.match(css, /body\.codex-embedded/);
});

test("managed assets keep their physical path and stable id across UI actions", async () => {
  const [app, server] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(new URL("../asset-browser/server.js", import.meta.url), "utf8"),
  ]);
  const absolutePathSource = extractFunctionSource(app, "absolutePath");
  const absolutePath = new Function("state", `${absolutePathSource}; return absolutePath;`)({ projectRoot: "C:/Workspace/Project" });
  assert.equal(absolutePath({ managed: true, resolvedPath: "C:\\ManagedStore\\x.png", relPath: "images/x.png" }), "C:\\ManagedStore\\x.png");

  const dirnameSource = extractFunctionSource(app, "projectDirname");
  const projectDirname = new Function(`${dirnameSource}; return projectDirname;`)();
  assert.equal(projectDirname("x.png"), "");
  assert.equal(projectDirname("images\\x.png"), "images");

  assert.match(app, /sourceAssetId: asset\.outputId \|\| asset\.caseRelPath/);
  assert.match(app, /outputId: result\.outputId \|\| ""/);
  assert.match(app, /body: JSON\.stringify\(\{ projectId: asset\.projectId, path: asset\.relPath, outputId: asset\.outputId \|\| "" \}\)/);
  assert.match(server, /resolvedPath: output\.storePath/);
  assert.match(server, /受管生成资产暂不支持物理删除/);
});

test("the embedded workspace exposes generic project navigation and inline filters", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /data-codex-workspace="bound"/);
  assert.match(html, /id="embeddedFilterMenu"/);
  assert.match(html, /id="embeddedCategoryFilter"/);
  assert.match(html, /id="embeddedStatusFilter"/);
  assert.match(html, /id="embeddedTypeFilter"/);
  assert.match(html, /placeholder="搜索当前文件夹"/);
  assert.match(app, /function syncEmbeddedFilterControls/);
  assert.match(css, /\.embedded-filter-menu/);
});

test("multi-asset composer handoff validates every path and stays bounded", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /message\.action === "use-many-in-codex"/);
  assert.match(injection, /assetPaths\.length <= 8/);
  assert.match(injection, /assetPaths\.every\(\(assetPath\) =>/);
  assert.match(injection, /addAssetReferencesToComposer\(assetPaths\)/);
  assert.match(injection, /\.join\("\\n"\)/);
});

test("selection mode supports explicit project routing, discard, and compare actions", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  for (const id of ["batchUseInCodex", "batchTaskAction", "batchDiscardAssets", "batchCompareAssets", "batchCurateAssets", "comparePanel"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /function routeSelectedAssetsForCurrentTask/);
  assert.match(app, /if \(!state\.codexBoundProject \|\| viewingBoundProject\)/);
  assert.match(app, /await openBatchMoveDialog\(\)/);
  assert.match(app, /await applyBatchStatus\("丢弃"\)/);
  assert.match(css, /\.compare-panel/);
});

test("moving to a project works without a task binding and requires an explicit destination", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  assert.match(app, /function preferredMoveTargetProjectId/);
  assert.match(app, /if \(!state\.codexBoundProject \|\| viewingBoundProject\) \{[\s\S]*?await openBatchMoveDialog\(\)/);
  assert.match(app, /if \(!state\.codexBoundProject \|\| viewingBoundProject\) \{[\s\S]*?await openMoveAssetDialog\(asset\)/);
  assert.match(app, /: "移动到项目…"/);
});

test("automatic project moves stay inside generic destination scan roots", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const names = ["normalizeProjectDirectory", "projectScanRootDirectories", "isDirectoryInProjectScanRoots", "automaticProjectRouteDirectory"];
  const source = names.map((name) => extractFunctionSource(app, name)).join("\n");
  const helpers = new Function(`${source}; return { automaticProjectRouteDirectory, isDirectoryInProjectScanRoots };`)();
  assert.equal(helpers.automaticProjectRouteDirectory({ id: "project-a", scanRoots: ["assets"] }), "assets");
  assert.equal(helpers.automaticProjectRouteDirectory({ id: "project-b", scanRoots: ["images", "videos"] }), null);
  const multiRoot = { id: "project-b", scanRoots: ["images", "videos"] };
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "images/stills"), true);
  assert.equal(helpers.isDirectoryInProjectScanRoots(multiRoot, "../outside"), false);
  assert.match(app, /!isDirectoryInProjectScanRoots\(targetProject, targetDirectory\)/);
});

test("one-click auto organize follows generic asset types and scan boundaries", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const names = [
    "normalizeProjectDirectory", "projectScanRootDirectories", "isDirectoryInProjectScanRoots",
    "joinProjectDirectory", "autoOrganizeAssetBucket", "isAutoOrganizeUnsafeDirectory",
    "selectedProjectScanRoot", "inferredProjectScanRoot", "autoOrganizeCanonicalDirectory",
    "autoOrganizeExistingDirectory", "recommendAutoOrganizeDirectory", "autoOrganizeMovePlan",
  ];
  const source = names.map((name) => extractFunctionSource(app, name)).join("\n");
  const helpers = new Function(`${source}; return { recommendAutoOrganizeDirectory, autoOrganizeMovePlan };`)();
  const project = { id: "project-a", scanRoots: ["assets"] };
  const image = { kind: "image", name: "hero.png", dir: "", relPath: "hero.png", caseId: "" };
  const video = { kind: "video", name: "shot.mp4", dir: "", relPath: "shot.mp4", caseId: "" };
  assert.equal(helpers.recommendAutoOrganizeDirectory(project, [image], ["assets/images"], "assets").directory, "assets/images");
  assert.deepEqual(helpers.autoOrganizeMovePlan(project, [image, video], ["assets/images", "assets/videos"], "assets").items.map((item) => item.directory), ["assets/images", "assets/videos"]);
  assert.match(html, /id="autoOrganizeMoveAsset"/);
  assert.match(app, /await confirmMoveAsset\(\{ autoOrganized: true, itemTargetDirectories \}\)/);
  assert.match(css, /\.move-asset-dialog \.auto-organize-action/);
});

test("folder hierarchy exposes every navigable level and switches cases", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const extractNamedFunction = (source, name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} is present`);
    const openingBrace = source.indexOf("{", start);
    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Could not extract ${name}`);
  };
  const helperSource = ["pathParts", "normalizeProjectDirectory", "projectScanRootDirectories", "completeCaseHierarchy"]
    .map((name) => extractNamedFunction(app, name))
    .join("\n");
  const complete = new Function(`${helperSource}; return completeCaseHierarchy;`)();
  const cases = complete([
    { id: "02-cases\\视频", name: "视频", relPath: "02-cases\\视频", scanRoot: "02-cases", mediaCount: 4 },
    { id: "02-cases\\图片", name: "图片", relPath: "02-cases\\图片", scanRoot: "02-cases", mediaCount: 5 },
  ], { id: "new-project", name: "新项目", scanRoots: ["02-cases"] });
  assert.ok(cases.some((item) => item.id === "."), "project root is navigable");
  assert.equal(cases.find((item) => item.id === "02-cases")?.mediaCount, 9, "missing scan-root case is synthesized");
  assert.ok(cases.some((item) => item.id === "02-cases\\视频"), "real child folders remain navigable");

  const multiRoot = complete([
    { id: "01_assets\\generated", relPath: "01_assets\\generated", scanRoot: "01_assets", mediaCount: 1 },
  ], { id: "multi-root", name: "多目录项目", scanRoots: ["01_assets", "04_outputs", "07_final"] });
  for (const root of ["01_assets", "04_outputs", "07_final"]) {
    assert.ok(multiRoot.some((item) => item.id === root), `${root} remains directly selectable even when empty`);
  }
  assert.match(app, /function renderCaseBreadcrumb\(currentProject, currentCase\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => activateCase\(level\.caseId\)\)/);
  assert.match(app, /button\.addEventListener\("click", \(\) => activateCase\(item\.id\)\)/);
  assert.match(app, /function activateCase\(caseId\)[\s\S]*?selectCase\(caseId\)\.catch\(showError\)/);
  assert.match(app, /async function selectCase\(caseId\)[\s\S]*?await loadAssets\(\{ workspaceGeneration: generation \}\)/);
  assert.match(app, /state\.selectedCase = previousCase;[\s\S]*?setCategoryFilter\(previousCategoryFilter\)/);
  assert.match(app, /children\.append\(makeCaseButton\(root\.item, "全部"\)\)/);
  assert.match(css, /\.case-crumb:not\(:disabled\):hover/);
});



test("out-of-order folder requests cannot overwrite the active folder", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const loadAssetsSource = extractFunctionSource(app, "loadAssets");
  const cacheHelpers = ["workspaceCacheKey", "readWorkspaceCache", "rememberWorkspaceCache", "beginWorkspaceCacheRequest", "isCurrentWorkspaceCacheRequest", "finishWorkspaceCacheRequest", "commitAssets"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const pending = new Map();
  const api = (url) => new Promise((resolve, reject) => {
    const caseId = new URL(url, "http://asset-console.local").searchParams.get("case");
    pending.set(caseId, { resolve, reject });
  });
  const state = {
    selectedProject: "project",
    selectedCase: "A",
    assets: [],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    deferredRefresh: null,
    workspaceSwitchGeneration: 1,
    assetLoadGeneration: 0,
    assetCache: new Map(),
    assetCacheRequestGeneration: new Map(),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 0,
  };
  let renderCount = 0;
  const loadAssets = new Function(
    "state", "api", "assetSelectionKey", "render", "updateBatchBar", "els",
    `const workspaceCacheLimit = 24; ${cacheHelpers}\n${loadAssetsSource}; return loadAssets;`
  )(state, api, (asset) => asset.id, () => { renderCount += 1; }, () => {}, { refreshStatus: { textContent: "" } });

  const loadA = loadAssets({ workspaceGeneration: 1 });
  state.selectedCase = "B";
  state.workspaceSwitchGeneration = 2;
  const loadB = loadAssets({ workspaceGeneration: 2 });
  pending.get("B").resolve({ assets: [{ id: "B" }] });
  assert.equal(await loadB, true);
  assert.equal(state.assets[0].id, "B");
  pending.get("A").resolve({ assets: [{ id: "A" }] });
  assert.equal(await loadA, false, "the stale request exits without committing");
  assert.equal(state.assets[0].id, "B", "late A cannot replace active B assets");
  assert.equal(renderCount, 1, "only the active response renders");

  state.selectedCase = "C";
  state.workspaceSwitchGeneration = 3;
  const loadC = loadAssets({ workspaceGeneration: 3 });
  state.selectedCase = "D";
  state.workspaceSwitchGeneration = 4;
  const loadD = loadAssets({ workspaceGeneration: 4 });
  pending.get("C").reject(new Error("stale failure"));
  assert.equal(await loadC, false, "stale failures are ignored instead of surfacing an unhandled rejection");
  pending.get("D").resolve({ assets: [{ id: "D" }] });
  assert.equal(await loadD, true);
  assert.equal(state.assets[0].id, "D");
});

test("revisiting a folder paints cached assets immediately and revalidates in the background", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const loadAssetsSource = extractFunctionSource(app, "loadAssets");
  const cacheHelpers = ["workspaceCacheKey", "readWorkspaceCache", "rememberWorkspaceCache", "beginWorkspaceCacheRequest", "isCurrentWorkspaceCacheRequest", "finishWorkspaceCacheRequest", "commitAssets"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const pending = [];
  const api = (url) => new Promise((resolve, reject) => {
    pending.push({ url, resolve, reject });
  });
  const state = {
    selectedProject: "project",
    selectedCase: "A",
    assets: [],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    deferredRefresh: null,
    workspaceSwitchGeneration: 1,
    assetLoadGeneration: 0,
    assetCache: new Map(),
    assetCacheRequestGeneration: new Map(),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 0,
  };
  let renderCount = 0;
  const loadAssets = new Function(
    "state", "api", "assetSelectionKey", "render", "updateBatchBar", "els",
    `const workspaceCacheLimit = 24; ${cacheHelpers}\n${loadAssetsSource}; return loadAssets;`
  )(state, api, (asset) => asset.id, () => { renderCount += 1; }, () => {}, { refreshStatus: { textContent: "" } });

  const firstA = loadAssets({ workspaceGeneration: 1 });
  pending.shift().resolve({ assets: [{ id: "A-old" }] });
  assert.equal(await firstA, true);

  state.selectedCase = "B";
  state.workspaceSwitchGeneration = 2;
  const firstB = loadAssets({ workspaceGeneration: 2 });
  pending.shift().resolve({ assets: [{ id: "B" }] });
  assert.equal(await firstB, true);

  state.selectedCase = "A";
  state.workspaceSwitchGeneration = 3;
  const beforeCachedRender = renderCount;
  assert.equal(await loadAssets({ workspaceGeneration: 3 }), true);
  assert.equal(state.assets[0].id, "A-old", "the previous folder snapshot is painted before the network returns");
  assert.equal(renderCount, beforeCachedRender + 1);
  assert.equal(pending.length, 1, "a background revalidation still starts");

  pending.shift().resolve({ assets: [{ id: "A-fresh" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.assets[0].id, "A-fresh", "fresh data replaces the cached snapshot without another switch");

  const preMutationRequest = loadAssets({ workspaceGeneration: 3, forceRefresh: true });
  state.workspaceCacheEpoch += 1;
  state.assetCache.clear();
  state.assetCacheRequestGeneration.clear();
  pending.shift().resolve({ assets: [{ id: "stale-after-mutation" }] });
  assert.equal(await preMutationRequest, false, "a response started before a structural mutation is stale");
  assert.equal(state.assets[0].id, "A-fresh", "pre-mutation data cannot overwrite the current workspace");
});

test("workspace cache is bounded, mutation-safe, and manual refresh bypasses it", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helperSource = [
    "rememberWorkspaceCache",
    "clearWorkspaceCaches",
    "beginWorkspaceCacheRequest",
    "isCurrentWorkspaceCacheRequest",
    "finishWorkspaceCacheRequest",
    "mutatesWorkspace",
  ].map((name) => extractFunctionSource(app, name)).join("\n");
  const state = {
    caseCache: new Map([["case", { cases: [] }]]),
    assetCache: new Map(),
    caseCacheRequestGeneration: new Map([["case", 4]]),
    assetCacheRequestGeneration: new Map([["asset", 7]]),
    workspaceCacheEpoch: 0,
    workspaceCacheRequestSerial: 7,
  };
  const helpers = new Function("state", `const workspaceCacheLimit = 24; ${helperSource}; return { rememberWorkspaceCache, clearWorkspaceCaches, beginWorkspaceCacheRequest, isCurrentWorkspaceCacheRequest, finishWorkspaceCacheRequest, mutatesWorkspace };`)(state);
  for (let index = 0; index < 30; index += 1) helpers.rememberWorkspaceCache(state.assetCache, `asset-${index}`, { assets: [] });
  assert.equal(state.assetCache.size, 24);
  assert.equal(state.assetCache.has("asset-0"), false, "old snapshots are evicted instead of growing without bound");

  helpers.clearWorkspaceCaches();
  assert.equal(state.caseCache.size, 0);
  assert.equal(state.assetCache.size, 0);
  assert.equal(state.workspaceCacheEpoch, 1);
  assert.equal(state.caseCacheRequestGeneration.size, 0);
  assert.equal(state.assetCacheRequestGeneration.size, 0, "an in-flight pre-mutation response can no longer refill stale data");
  for (let index = 0; index < 1000; index += 1) {
    const key = `request-${index}`;
    const request = helpers.beginWorkspaceCacheRequest(state.assetCacheRequestGeneration, key);
    assert.equal(helpers.isCurrentWorkspaceCacheRequest(state.assetCacheRequestGeneration, key, request), true);
    helpers.finishWorkspaceCacheRequest(state.assetCacheRequestGeneration, key, request);
  }
  assert.equal(state.assetCacheRequestGeneration.size, 0, "completed request tokens do not accumulate with every visited folder");
  assert.equal(helpers.mutatesWorkspace("/api/batch-move", { method: "POST" }), true);
  assert.equal(helpers.mutatesWorkspace("/api/assets?project=p&case=c"), false);
  assert.match(app, /cacheRequest\.epoch !== state\.workspaceCacheEpoch[\s\S]*?state\.caseLoadGeneration/);
  assert.match(app, /async function performManualRefresh\(\)[\s\S]*?loadProjects\(\)[\s\S]*?loadCases\(\{[\s\S]*?forceRefresh: true[\s\S]*?loadAssets\(\{ workspaceGeneration, forceRefresh: true \}\)/);
  assert.match(app, /refreshButton\.addEventListener\("click", \(\) => performManualRefresh\(\)/);
});

test("a removed active folder immediately shows the replacement folder cache or a clean loading state", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const helpers = ["workspaceCacheKey", "readWorkspaceCache", "commitAssets", "prepareAssetsForCaseChange"]
    .map((name) => extractFunctionSource(app, name)).join("\n");
  const state = {
    selectedCase: "B",
    assets: [{ id: "A-visible" }],
    selectedAsset: null,
    selectedAssetKeys: new Set(),
    assetCache: new Map([["project\u0000B", { assets: [{ id: "B-cached" }] }]]),
  };
  const els = { refreshStatus: { textContent: "" } };
  const prepare = new Function(
    "state", "assetSelectionKey", "render", "updateBatchBar", "els",
    `${helpers}; return prepareAssetsForCaseChange;`
  )(state, (asset) => asset.id, () => {}, () => {}, els);

  prepare("project");
  assert.equal(state.assets[0].id, "B-cached", "the replacement folder cache paints synchronously");
  state.assetCache.clear();
  state.assets = [{ id: "A-visible" }];
  prepare("project");
  assert.deepEqual(state.assets, [], "old-folder cards are cleared before the replacement request finishes");
  assert.match(els.refreshStatus.textContent, /正在读取素材/);
});



test("workspace switches use restrained motion and respect reduced-motion preferences", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(app, /const transition = await beginWorkspaceSwitch\(generation\)/);
  assert.match(app, /workspaceSwitchGeneration/);
  assert.match(app, /function releaseWorkspaceSwitch/);
  assert.match(app, /surface\.removeAttribute\("aria-busy"\)/);
  assert.match(app, /duration: 90/);
  assert.match(app, /duration: 190/);
  assert.match(app, /reducedMotionPreferred\(\)/);
  assert.match(css, /codex-workspace-switcher button[\s\S]*transition: color 160ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("a cancelled workspace exit cannot leave the asset grid busy", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const cancelSource = app.match(/function cancelElementAnimations\(element\) \{[\s\S]*?\n\}/)?.[0];
  const beginSource = app.match(/async function beginWorkspaceSwitch\(generation\) \{[\s\S]*?\n\}/)?.[0];
  const releaseSource = app.match(/function releaseWorkspaceSwitch\(transition\) \{[\s\S]*?\n\}/)?.[0];
  const finishSource = app.match(/function finishWorkspaceSwitch\(transition\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(cancelSource && beginSource && releaseSource && finishSource);

  const animations = [];
  const attributes = new Map();
  const surface = {
    dataset: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAnimations() { return animations.filter((animation) => !animation.settled); },
    animate(_frames, options) {
      let resolve;
      let reject;
      const animation = {
        options,
        settled: false,
        finished: new Promise((res, rej) => { resolve = res; reject = rej; }),
        cancel() {
          if (animation.settled) return;
          animation.settled = true;
          reject(new Error("cancelled"));
        },
        finish() {
          if (animation.settled) return;
          animation.settled = true;
          resolve();
        }
      };
      animations.push(animation);
      return animation;
    }
  };
  const createHelpers = new Function("state", "els", "reducedMotionPreferred", `${cancelSource}\n${beginSource}\n${releaseSource}\n${finishSource}; return { beginWorkspaceSwitch, finishWorkspaceSwitch };`);
  const { beginWorkspaceSwitch, finishWorkspaceSwitch } = createHelpers(
    { compareMode: false },
    { comparePanel: { hidden: true }, assetGrid: surface },
    () => false
  );
  const starting = beginWorkspaceSwitch(1);
  animations[0].cancel();
  const transition = await starting;
  finishWorkspaceSwitch(transition);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(surface.dataset.workspaceSwitchToken, undefined);
  assert.equal(animations.at(-1).options.duration, 190);
});

test("reduced-motion workspace switches keep stale cards busy until the current load finishes", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const cancelSource = extractFunctionSource(app, "cancelElementAnimations");
  const beginSource = extractFunctionSource(app, "beginWorkspaceSwitch");
  const releaseSource = extractFunctionSource(app, "releaseWorkspaceSwitch");
  const finishSource = extractFunctionSource(app, "finishWorkspaceSwitch");
  const attributes = new Map();
  const surface = {
    dataset: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAnimations() { return []; },
  };
  const createHelpers = new Function("state", "els", "reducedMotionPreferred", `${cancelSource}\n${beginSource}\n${releaseSource}\n${finishSource}; return { beginWorkspaceSwitch, finishWorkspaceSwitch };`);
  const { beginWorkspaceSwitch, finishWorkspaceSwitch } = createHelpers(
    { compareMode: false },
    { comparePanel: { hidden: true }, assetGrid: surface },
    () => true
  );

  const first = await beginWorkspaceSwitch(1);
  assert.equal(first.motion, false);
  assert.equal(attributes.get("aria-busy"), "true");
  assert.equal(surface.dataset.workspaceSwitchToken, "1");

  const second = await beginWorkspaceSwitch(2);
  finishWorkspaceSwitch(first);
  assert.equal(attributes.get("aria-busy"), "true", "an old request cannot release the current busy state");
  assert.equal(surface.dataset.workspaceSwitchToken, "2");

  finishWorkspaceSwitch(second);
  assert.equal(attributes.has("aria-busy"), false);
  assert.equal(surface.dataset.workspaceSwitchToken, undefined);
});

test("large asset grids hydrate media only near the viewport", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  const escapeSource = extractFunctionSource(app, "escapeHtml");
  const previewSource = extractFunctionSource(app, "mediaPreview");
  const mediaPreview = new Function(`${escapeSource}; ${previewSource}; return mediaPreview;`)();
  const asset = { kind: "video", mediaUrl: "/media?asset=large-video" };
  const cardMarkup = mediaPreview(asset);
  const detailMarkup = mediaPreview(asset, true);

  assert.match(cardMarkup, /data-media-src="\/media\?asset=large-video"/);
  assert.match(cardMarkup, /preload="none"/);
  assert.doesNotMatch(cardMarkup, /\ssrc="/);
  assert.match(detailMarkup, /\ssrc="\/media\?asset=large-video"/);
  assert.match(detailMarkup, /preload="metadata"/);
  assert.match(app, /new IntersectionObserver/);
  assert.match(app, /rootMargin: "480px 0px"/);
  assert.match(app, /document\.createDocumentFragment\(\)/);
  assert.doesNotMatch(css, /\.asset-card \.preview img,[\s\S]{0,260}will-change: transform/);
  const previewRule = css.match(/\.asset-card \.preview img,[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(previewRule, /scale\(1\.001\)/);
  assert.doesNotMatch(css, /(?:body\.selection-mode )?\.card-actions\s*\{[^}]*?(?:will-change|translate3d)/);
});

test("workspace data starts loading without waiting for the exit animation", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const beginSource = extractFunctionSource(app, "beginWorkspaceSwitch");
  assert.match(beginSource, /void animation\.finished\.catch/);
  assert.doesNotMatch(beginSource, /await animation\.finished/);
});

test("embedded terminology separates asset location, project binding, and conversation attachment", async () => {
  const [html, app] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
  ]);
  assert.match(html, />项目素材</);
  assert.match(html, /关联项目：未设置/);
  assert.match(html, /附加到当前对话/);
  assert.match(html, /丢弃（不删除）/);
  assert.match(app, /`关联项目：\$\{boundName\}`/);
  assert.match(app, /移动到「\$\{boundName\}」/);
});

test("the embedded binding flow can create and immediately bind a project", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="codexNewProjectButton"/);
  assert.match(html, /id="codexNewProjectDialog"/);
  assert.match(html, /id="codexNewProjectName"/);
  assert.match(html, /id="codexNewProjectPath"/);
  assert.match(html, /新建并关联/);
  assert.match(app, /function isAbsoluteWindowsProjectPath/);
  assert.match(app, /api\("\/api\/projects", \{/);
  assert.match(app, /await saveCodexProjectBinding\(projectId\)/);
  assert.match(app, /await selectProject\(projectId\)/);
  assert.match(app, /已新建，但自动关联失败/);
  assert.match(css, /\.codex-new-project-dialog/);
});

test("new project follow-up fails closed and can recover a lost create response by path", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const normalizeSource = app.match(/function normalizeWindowsProjectPath\(value\) \{[\s\S]*?\n\}/)?.[0];
  const findSource = app.match(/function findCreatedProject\(projects, expectedId, projectPath\) \{[\s\S]*?\n\}/)?.[0];
  const resolveSource = app.match(/function resolveUsableCreatedProject\(projects, expectedId, projectPath\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalizeSource, "project path normalizer is present");
  assert.ok(findSource, "created project finder is present");
  assert.ok(resolveSource, "created project resolver is present");
  const helpers = new Function(`${normalizeSource}\n${findSource}\n${resolveSource}; return { findCreatedProject, resolveUsableCreatedProject };`)();
  const { findCreatedProject: find, resolveUsableCreatedProject: resolve } = helpers;

  const usable = { id: "new", name: "新项目", path: "C:\\Workspace\\New", exists: true };
  assert.equal(resolve([usable], "new", "C:\\Workspace\\New"), usable);
  assert.equal(resolve([usable], "", "c:/workspace/new/"), usable, "a lost POST response recovers by normalized path");
  const createdButUnavailable = { ...usable, exists: false };
  assert.equal(
    find([createdButUnavailable], "", "c:/workspace/new/"),
    createdButUnavailable,
    "a lost POST response still confirms that an unavailable project was created"
  );
  assert.throws(
    () => resolve([createdButUnavailable], "new", "C:\\Workspace\\New"),
    /尚未出现在可用项目列表中/,
    "an unavailable project must not be reported as selected"
  );
  assert.throws(
    () => resolve([], "new", "C:\\Workspace\\New"),
    /尚未出现在可用项目列表中/,
    "a missing refreshed project must fail closed"
  );
  assert.match(app, /const recovery = await api\("\/api\/projects"\)/);
  assert.match(app, /const recoveredProject = findCreatedProject\(recovery\.projects, "", projectPath\)/);
  assert.match(app, /已新建，但自动关联失败/);
});

test("composer handoff exposes an explicit return path and restores focus", async () => {
  const [injection, html, app] = await Promise.all([
    readFile(injectionPath, "utf8"),
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
  ]);
  assert.match(html, /id="codexAttachResult"/);
  assert.match(html, /返回对话并聚焦输入框/);
  assert.match(app, /action: "return-to-codex"/);
  assert.match(injection, /message\.action === "return-to-codex"/);
  assert.match(injection, /closeAssetConsolePanel\(\{ focusTarget: "composer" \}\)/);
  assert.match(injection, /assetConsoleReturnFocus/);
  assert.match(injection, /frame\.focus\(\)/);
});

test("empty results are contextual and asset cards support keyboard activation", async () => {
  const [app, css] = await Promise.all([
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(app, /没有匹配的素材/);
  assert.match(app, /clear-empty-filters/);
  assert.match(app, /function clearAssetDiscoveryFilters/);
  assert.match(app, /card\.addEventListener\("keydown"/);
  assert.match(app, /\["Enter", " "\]/);
  assert.match(css, /\.card-select-toggle[\s\S]*width: 40px/);
  assert.match(css, /\.asset-card:focus-visible \.preview/);
});

test("the current folder toolbar exposes an inline create-folder flow", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="newFolderButton"[\s\S]*?＋[\s\S]*?新建文件夹/);
  assert.match(html, /id="newFolderDialog"/);
  assert.match(html, /id="newFolderName"[^>]*maxlength="120"/);
  assert.match(app, /function currentFolderCreationContext/);
  assert.match(app, /api\("\/api\/folders", \{\s*method: "POST"/);
  assert.match(app, /parentPath: context\.parentPath/);
  assert.match(app, /已新建并打开/);
  assert.match(css, /\.toolbar > \.new-folder-button/);
});

test("folder cards expose direct rename without hiding the open action", async () => {
  const [html, app, css] = await Promise.all([
    readFile(embeddedIndexPath, "utf8"),
    readFile(embeddedAppPath, "utf8"),
    readFile(embeddedCssPath, "utf8"),
  ]);
  assert.match(html, /id="renameFolderDialog"/);
  assert.match(html, /id="renameFolderName"[^>]*maxlength="120"/);
  assert.match(html, /只修改文件夹名称，里面的素材保持不变/);
  assert.match(app, /document\.createElement\("article"\)/);
  assert.match(app, /renameButton\.textContent = "改名"/);
  assert.match(app, /openButton\.textContent = "打开"/);
  assert.match(app, /api\("\/api\/folders", \{\s*method: "PATCH"/);
  assert.match(app, /parentCaseId: state\.selectedCase/);
  assert.match(app, /state\.selectedCase = context\.parentCaseId/);
  assert.match(css, /\.folder-card-actions/);
  assert.match(css, /\.folder-card-preview-button:focus-visible/);
});

test("empty folders returned by the service remain navigable inside project scan roots", async () => {
  const app = await readFile(embeddedAppPath, "utf8");
  const pathSource = extractFunctionSource(app, "pathParts");
  const normalizeSource = extractFunctionSource(app, "normalizeProjectDirectory");
  const rootsSource = extractFunctionSource(app, "projectScanRootDirectories");
  const hierarchySource = extractFunctionSource(app, "completeCaseHierarchy");
  const complete = new Function(`${pathSource}\n${normalizeSource}\n${rootsSource}\n${hierarchySource}; return completeCaseHierarchy;`)();
  const result = complete([], { name: "测试项目", scanRoots: ["02-cases"] }, [
    { path: "" },
    { path: "02-cases" },
    { path: "02-cases\\角色参考" },
    { path: "04_outputs" },
  ]);
  const ids = result.map((item) => item.id);
  assert.ok(ids.includes("."));
  assert.ok(ids.includes("02-cases"));
  assert.ok(ids.includes("02-cases\\角色参考"), "an empty nested folder is synthesized into navigation");
  assert.equal(ids.includes("04_outputs"), false, "folders outside scan roots stay hidden");
});

test("usage indicator animates by transform instead of layout width", async () => {
  const injection = await readFile(injectionPath, "utf8");
  assert.match(injection, /transition: transform 180ms ease/);
  assert.match(injection, /style\.transform = `scaleX/);
  assert.doesNotMatch(injection, /transition: width 180ms ease/);
});
