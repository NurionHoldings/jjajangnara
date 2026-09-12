/**
 * Arkaon Platform Onboarding DNA — Phase A verify (hardened)
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";

process.env.ARKAON_DEV_FAIL_OPEN = "1";

const require = createRequire(import.meta.url);
const planner = require("../netlify/functions/_arkaon-platform-onboarding.js");
const arkaon = require("../netlify/functions/arkaon-participation.js");
const guards = require("../netlify/functions/_arkaon-guards.js");

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
  assert.ok(onboard.nextActions.some((a) => a.type === "post_affiliate_draft"));
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

  const connector = require("../netlify/functions/_dosirak-vendor-draft-connector.js");
  const snap = connector.buildMenuCatalogSnapshot();
  assert.ok(snap.menu_catalog_ids.includes("jjajang"));
  assert.ok(snap.menu.includes("짜장면"));
  pass("dosirak connector: menu catalog snapshot");

  const payload = connector.buildVendorDraftPayload({
    consents: {
      privacyAt: "2026-09-12T00:00:00.000Z",
      termsAt: "2026-09-12T00:00:00.000Z",
    },
    merchant: { phone: "01012345678" },
    dryRun: true,
  });
  assert.equal(payload.data.biz_name.includes("짜장나라"), true);
  assert.ok(!("account_no" in payload.data));
  pass("dosirak connector: draft payload without bank");

  let threw = false;
  try {
    connector.buildVendorDraftPayload({ consents: {}, merchant: { phone: "01012345678" } });
  } catch (e) {
    threw = e.code === "CONSENT_REQUIRED";
  }
  assert.equal(threw, true);
  pass("dosirak connector: consent gate");

  const registry = await arkaon.handler({
    httpMethod: "GET",
    queryStringParameters: { action: "platform-registry" },
    headers: {},
  });
  assert.equal(registry.statusCode, 200);
  const registryBody = JSON.parse(registry.body);
  assert.equal(registryBody.success, true);
  const dosirak = registryBody.data.platforms.find((p) => p.id === "dosirak.store");
  assert.equal(dosirak.status, "connector_wired_draft");
  const aibaebyPlat = registryBody.data.platforms.find((p) => p.id === "aibaeby.com");
  assert.equal(aibaebyPlat.status, "connector_wired_draft");
  pass("API platform-registry");

  const aibaebyPlan = planner.planOnboarding("aibaeby.com 입점해줘");
  assert.equal(aibaebyPlan.ok, true);
  assert.ok(aibaebyPlan.nextActions.some((a) => a.platformId === "aibaeby.com"));
  pass("command: aibaeby 입점 → post_affiliate_draft");

  const aibaebyConnector = require("../netlify/functions/_aibaeby-merchant-draft-connector.js");
  const aibaebyPayload = aibaebyConnector.buildMerchantDraftPayload({
    consents: {
      privacyAt: "2026-09-12T00:00:00.000Z",
      termsAt: "2026-09-12T00:00:00.000Z",
    },
    merchant: { phone: "01012345678" },
    dryRun: true,
  });
  assert.ok(aibaebyPayload.data.shop_name.includes("짜장나라"));
  assert.ok(!("account_number" in aibaebyPayload.data));
  pass("aibaeby connector: draft payload without bank");

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

  const ready = await arkaon.handler({
    httpMethod: "GET",
    queryStringParameters: { action: "connector-readiness" },
    headers: {},
  });
  assert.equal(ready.statusCode, 200);
  const readyBody = JSON.parse(ready.body);
  assert.ok(readyBody.data.dosirak);
  assert.ok(readyBody.data.aibaeby);
  pass("API connector-readiness");

  const execMissing = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "onboarding-execute" },
    headers: {},
    body: JSON.stringify({
      platformId: "dosirak.store",
      dryRun: true,
      consents: {
        privacyAt: "2026-09-12T00:00:00.000Z",
        termsAt: "2026-09-12T00:00:00.000Z",
      },
      merchant: { phone: "01012345678" },
    }),
  });
  assert.equal(execMissing.statusCode, 422);
  const execBody = JSON.parse(execMissing.body);
  assert.equal(execBody.data.code, "CONNECTOR_ENV_MISSING");
  assert.ok(execBody.data.draftPreview);
  pass("API onboarding-execute fail-closed without env");

  const execAibaeby = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "onboarding-execute" },
    headers: {},
    body: JSON.stringify({
      platformId: "aibaeby.com",
      dryRun: true,
      consents: {
        privacyAt: "2026-09-12T00:00:00.000Z",
        termsAt: "2026-09-12T00:00:00.000Z",
      },
      merchant: { phone: "01012345678" },
    }),
  });
  assert.equal(execAibaeby.statusCode, 422);
  assert.equal(JSON.parse(execAibaeby.body).data.code, "CONNECTOR_ENV_MISSING");
  pass("API onboarding-execute aibaeby fail-closed without env");

  const connectPlan = planner.planOnboarding("도시락 실연동");
  assert.equal(connectPlan.ok, true);
  assert.equal(connectPlan.intent, "TEMPLATE_CONNECT");
  assert.equal(connectPlan.mode, "template_connect_assist");
  assert.ok(connectPlan.nextActions.some((a) => a.type === "post_template_bind"));
  pass("command: 실연동 → TEMPLATE_CONNECT");

  const connectAssist = require("../netlify/functions/_template-connect-assist.js");
  assert.ok(connectAssist.menuCatalogDigest().startsWith("sha256:"));
  pass("template-connect: menu digest");

  const connectExec = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "template-connect-execute" },
    headers: {},
    body: JSON.stringify({
      platformId: "dosirak.store",
      dryRun: true,
      vendor: { vendor_id: "v_existing", phone_last4: "5678" },
      consents: {
        privacyAt: "2026-09-12T00:00:00.000Z",
        termsAt: "2026-09-12T00:00:01.000Z",
        connectAt: "2026-09-12T00:00:02.000Z",
      },
    }),
  });
  assert.equal(connectExec.statusCode, 422);
  assert.equal(JSON.parse(connectExec.body).data.code, "CONNECTOR_ENV_MISSING");
  pass("API template-connect-execute fail-closed without env");

  const noPlatform = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "onboarding-execute" },
    headers: {},
    body: JSON.stringify({
      dryRun: true,
      consents: { privacyAt: "a", termsAt: "b" },
      merchant: { phone: "01012345678" },
    }),
  });
  assert.equal(noPlatform.statusCode, 422);
  assert.equal(JSON.parse(noPlatform.body).code, "PLATFORM_REQUIRED");
  pass("onboarding-execute requires platformId");

  const ambiguous = planner.planOnboarding("도시락 이미 입점");
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, "INTENT_AMBIGUOUS");
  pass("ambiguous 입점+이미입점 → INTENT_AMBIGUOUS");

  const noTouchHit = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "onboarding-execute" },
    headers: {},
    body: JSON.stringify({
      platformId: "dosirak.store",
      dryRun: true,
      account_number: "123",
      consents: { privacyAt: "a", termsAt: "b" },
      merchant: { phone: "01012345678" },
    }),
  });
  assert.equal(noTouchHit.statusCode, 403);
  assert.equal(JSON.parse(noTouchHit.body).code, "NO_TOUCH_BLOCKED");
  pass("execute blocked by no-touch finance field");

  const visit = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "agent-visits-announce" },
    headers: {},
    body: JSON.stringify({ agent: "gpt", purpose: "hardening" }),
  });
  assert.equal(visit.statusCode, 200);
  const visitId = JSON.parse(visit.body).data.id;
  const closed = await arkaon.handler({
    httpMethod: "POST",
    queryStringParameters: { action: "agent-visits-close" },
    headers: {},
    body: JSON.stringify({ id: visitId }),
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(JSON.parse(closed.body).data.status, "closed");
  pass("agent-visits-close");

  delete process.env.ARKAON_DEV_FAIL_OPEN;
  delete process.env.ARKAON_AGENT_HANDOFF_SECRET;
  assert.equal(guards.authOk({ headers: {} }), false);
  pass("agent auth fail-closed without secret");
  process.env.ARKAON_DEV_FAIL_OPEN = "1";

  console.log("\nArkaon onboarding DNA verify: PASS");
}

run().catch((error) => {
  console.error("Arkaon onboarding DNA verify: FAIL", error);
  process.exit(1);
});
