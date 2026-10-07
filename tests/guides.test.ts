import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { GUIDE_VERSION, guideRegistry, guideTargets } from "../src/guides/registry";

const targetOwners = {
  homeHero: "src/components/views/QuickStartView.tsx",
  homeContinue: "src/components/views/QuickStartView.tsx",
  mainNavigation: "src/components/Workspace.tsx",
  projectSelector: "src/components/Workspace.tsx",
  sourceToolbar: "src/components/views/SourceManagerView.tsx",
  sourceAdd: "src/components/views/SourceManagerView.tsx",
  sourceList: "src/components/views/SourceManagerView.tsx",
  nodeToolbar: "src/components/views/NodePoolView.tsx",
  nodeImport: "src/components/views/NodePoolView.tsx",
  nodeList: "src/components/views/NodePoolView.tsx",
  nodeSelection: "src/components/views/NodePoolView.tsx",
  groupBoard: "src/components/views/GroupsView.tsx",
  groupCreate: "src/components/views/GroupsView.tsx",
  groupNodePool: "src/components/views/GroupsView.tsx",
  ruleMode: "src/components/views/RulesView.tsx",
  ruleTemplates: "src/components/views/RulesView.tsx",
  ruleAdd: "src/components/views/RulesView.tsx",
  ruleList: "src/components/views/RulesView.tsx",
  generatorSteps: "src/components/views/GeneratorView.tsx",
  generatorMain: "src/components/views/GeneratorView.tsx",
  publishAction: "src/components/views/GeneratorView.tsx",
  helpButton: "src/components/GuidedTour.tsx",
} satisfies Record<keyof typeof guideTargets, string>;

test("教程版本与应用版本同步", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version: string };
  assert.equal(GUIDE_VERSION, pkg.version);
});

test("教程和步骤标识唯一且覆盖核心流程", () => {
  const guideIds = guideRegistry.map((guide) => guide.id);
  assert.equal(new Set(guideIds).size, guideIds.length);
  const stepIds = guideRegistry.flatMap((guide) => guide.steps.map((step) => `${guide.id}:${step.id}`));
  assert.equal(new Set(stepIds).size, stepIds.length);
  for (const required of ["quickstart", "sources", "nodes", "groups", "rules", "publish"]) assert.ok(guideIds.includes(required), required);
  const targetValues = Object.values(guideTargets);
  assert.equal(new Set(targetValues).size, targetValues.length);
  for (const guide of guideRegistry) for (const step of guide.steps) assert.ok(targetValues.includes(step.target), `${guide.id}:${step.id}`);
});

test("每一个教程目标都由页面中的稳定锚点实现", () => {
  for (const [key, filename] of Object.entries(targetOwners)) {
    const source = fs.readFileSync(path.resolve(filename), "utf8");
    assert.ok(source.includes(`guideTargets.${key}`), `${key} 缺少页面锚点：${filename}`);
  }
});
