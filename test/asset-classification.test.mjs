import test from "node:test";
import assert from "node:assert/strict";
import { classifyAsset } from "../asset-browser/asset-classification.js";

test("人工分组独立于质量状态并优先于路径规则", () => {
  const classified = classifyAsset({
    kind: "video",
    relPath: "outputs/hero.mp4",
    smartGroup: "待确认",
    userStatus: "可用"
  });
  assert.equal(classified.group, "review");
  assert.equal(classified.source, "人工 smartGroup");
  assert.equal(classifyAsset({ kind: "image", relPath: "outputs/a.png", category: "干扰项" }).source, "人工 category");
  assert.equal(classifyAsset({ kind: "image", relPath: "outputs/a.png", tags: ["#待确认"] }).source, "人工 tags");
  assert.equal(classifyAsset({ smartGroup: "正式资产", category: "干扰项", tags: ["待确认"] }).group, "official");
});

test("未知音视频不会默认正式，单独的 9:16 也不会推断角色资产", () => {
  assert.equal(classifyAsset({ kind: "audio", name: "take.wav" }).group, "review");
  assert.equal(classifyAsset({ kind: "video", name: "take.mp4" }).group, "review");
  assert.equal(classifyAsset({ kind: "image", name: "portrait.png", width: 1080, height: 1920 }).group, "review");
});

test("明确输出目录与干扰文件可解释分类", () => {
  assert.deepEqual(classifyAsset({ kind: "video", relPath: "outputs/videos/shot-01.mp4" }).group, "official");
  assert.deepEqual(classifyAsset({ kind: "audio", relPath: "cache/waveform.tmp" }).group, "noise");
  const managed = classifyAsset({ managed: true, kind: "video", smartGroup: "generated", classification: { group: "generated", source: "registry", confidence: 1 } });
  assert.equal(managed.group, "official");
  assert.equal(managed.source, "registry");
  assert.equal(managed.confidence, "高");
});
