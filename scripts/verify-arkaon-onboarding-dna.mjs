/**
 * Arkaon Platform Onboarding DNA — Phase A verify
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const planner = require("../netlify/functions/_arkaon-platform-onboarding.js");
const arkaon = require("../netlify/functions/arkaon-participation.js");

function pass(name) {
  console.log(`PASS  ${name}`);
}

async function run() {
  const manifest = planner.loadManifest();
  assert.ok(manifest);
  assert.equal(manifest.phase, "A");
  assert.ok(manifest.platforms.some((p) => p.id === "dosirak.store"));
  assert.ok(manifest.platforms.some((p) => p.id === "aibaeby.com"));
  pass("manifest: affiliate platforms registered");

  const onboard = planner.planOnboarding("도시락.store 입점해줘");
  assert.equal(onboard.ok, true);
  assert.equal(onboard.intent, "PLATFORM_ONBOARD");
  assert.equal(onboard.platform.id, "dosirak.store");
  assert.equal(onboard.mode, "propose_only");
  assert.ok(onboard.playbook.length >= 5);
  pass("command: 입점 → dosirak playbook");

  const app = planner.planOnboarding("aibaeby 앱 다운로드");
  assert.equal(app.ok, true);
  assert.equal(app.intent, "APP_INSTALL");
  assert.equal(app.platform.id, "aibaeby.com");
  pass("command: 앱 다운로드 → aibaeby playbook");

  const missingPlatform = planner.planOnboarding("입점해줘");
  assert.equal(missingPlatform.ok, false);
  assert.equal(missingPlatform.code, "PLATFORM_REQUIRED");
  pass("입점 alone → PLATFORM_REQUIRED");

  const unknown = planner.planOnboarding("날씨 알려줘");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "INTENT_UNKNOWN");
  pass("unknown intent rejected");

  assert.ok(manifest.authority.forbidden.includes("execute_payout"));
  assert.ok(manifest.fieldMapping.neverAutoFill.includes("bankAccount"));
  pass("authority: no payout / no bank autofill");

  const noTouch = planner.loadNoTouch();
  assert.ok(noTouch.bannedActions.includes("scrape_non_affiliate_delivery_platform"));
  pass("no-touch map loaded");

  const registry = await arkaon.handler({
    httpMethod: "GET",
    queryStringParameters: { action: "platform-registry" },
    headers: {},
  });
  assert.equal(registry.statusCode, 200);
  const registryBody = JSON.parse(registry.body);
  assert.equal(registryBody.success, true);
  pass("API platform-registry");

  const intentRes = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "onboarding-intent" },
    headers: {},
    body: JSON.stringify({ command: "도시락 가입 도와줘" }),
  });
  assert.equal(intentRes.statusCode, 200);
  const intentBody = JSON.parse(intentRes.body);
  assert.equal(intentBody.data.intent, "SIGNUP_UNBLOCK");
  assert.equal(intentBody.data.platform.id, "dosirak.store");
  pass("API onboarding-intent + DNA record");

  console.log("\nArkaon onboarding DNA verify: PASS");
}

run().catch((error) => {
  console.error("Arkaon onboarding DNA verify: FAIL", error);
  process.exit(1);
});
