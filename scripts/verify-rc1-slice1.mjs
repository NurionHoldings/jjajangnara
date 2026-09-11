/**
 * RC1 Slice 1 검증 게이트 (+ Remediation RED)
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const catalog = require("../netlify/functions/_menu-catalog.js");
const rc1 = require("../netlify/functions/_rc1-orders.js");
const createOrder = require("../netlify/functions/create-order.js");
const pendingOrder = require("../netlify/functions/pending-order.js");
const tossConfirm = require("../netlify/functions/toss-confirm.js");

const SECRET = "rc1-test-checkout-secret-do-not-use-prod";
const results = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`PASS  ${name}`);
}

function expectFail(fn, code) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected failure");
  if (code) assert.equal(caught.code, code);
  return caught;
}

async function expectFailAsync(fn, code) {
  let caught;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected failure");
  if (code) assert.equal(caught.code, code);
  return caught;
}

function validBody(overrides = {}) {
  return {
    items: [{ menuId: "jjajang", quantity: 2, optionIds: ["large"] }],
    utensils: "O",
    address: "세종특별자치시 조치원읍 테스트로 1",
    phone: "01012345678",
    request: "단무지 많이 주세요",
    clientRequestId: "web_test_request_01",
    ...overrides,
  };
}

function createOpts(store, extra = {}) {
  return {
    force: true,
    store,
    checkoutSecret: SECRET,
    ...extra,
  };
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    });
}

async function run() {
  // --- 기존 게이트 ---
  const single = rc1.priceItems([{ menuId: "jjajang", quantity: 2, optionIds: ["large"] }]);
  assert.equal(single[0].lineTotal, 18000);
  pass("정상 단품 주문 → 서버 계산");

  const set = rc1.priceItems([
    { setId: "solo", quantity: 1, mains: [{ mainId: "m3", optionIds: ["double"] }] },
  ]);
  assert.equal(set[0].lineTotal, 18000);
  pass("세트·옵션 추가금 → 서버 계산");

  expectFail(() => rc1.priceItems([{ menuId: "nope", quantity: 1 }]), "UNKNOWN_MENU");
  pass("존재하지 않는 메뉴 ID → 거절");

  expectFail(
    () => rc1.priceItems([{ menuId: "jjajang", quantity: 1, optionIds: ["xl"] }]),
    "UNKNOWN_OPTION"
  );
  expectFail(
    () => rc1.priceItems([{ menuId: "jjamjja", quantity: 1, optionIds: ["large"] }]),
    "UNKNOWN_OPTION"
  );
  expectFail(
    () =>
      rc1.priceItems([
        { setId: "solo", quantity: 1, mains: [{ mainId: "m99", optionIds: [] }] },
      ]),
    "UNKNOWN_SET_MAIN"
  );
  expectFail(
    () =>
      rc1.priceItems([
        { setId: "couple", quantity: 1, mains: [{ mainId: "m1", optionIds: [] }] },
      ]),
    "INVALID_SET_MAINS"
  );
  pass("존재하지 않는 옵션·잘못된 조합 → 거절");

  expectFail(() => rc1.priceItems([{ menuId: "jjajang", quantity: 0 }]), "INVALID_QUANTITY");
  expectFail(() => rc1.priceItems([{ menuId: "jjajang", quantity: -1 }]), "INVALID_QUANTITY");
  expectFail(() => rc1.priceItems([{ menuId: "jjajang", quantity: 1.5 }]), "INVALID_QUANTITY");
  expectFail(() => rc1.priceItems([{ menuId: "jjajang", quantity: 99 }]), "INVALID_QUANTITY");
  assert.equal(catalog.MAX_LINE_QUANTITY, 20);
  pass("음수·0·소수·과도한 수량 → 거절 (상한 존재)");

  expectFail(
    () => rc1.assertNoClientAuthorityFields({ items: [{ menuId: "jjajang", quantity: 2, price: 1 }] }),
    "CLIENT_AUTHORITY_FORBIDDEN"
  );
  expectFail(
    () => rc1.assertNoClientAuthorityFields({ total: 1, items: [{ menuId: "jjajang", quantity: 2 }] }),
    "CLIENT_AUTHORITY_FORBIDDEN"
  );
  expectFail(
    () =>
      rc1.assertNoClientAuthorityFields({
        items: [{ menuId: "jjajang", quantity: 2, name: "가짜메뉴" }],
      }),
    "CLIENT_AUTHORITY_FORBIDDEN"
  );
  pass("클라이언트 price/total/메뉴명 무시·거절");

  expectFail(
    () => rc1.assertNoClientAuthorityFields({ orderId: "client-chosen", ...validBody() }),
    "CLIENT_AUTHORITY_FORBIDDEN"
  );
  pass("orderId를 클라이언트가 지정할 수 없음");

  expectFail(
    () =>
      rc1.assertNoClientAuthorityFields({
        expiresAt: "2099-01-01T00:00:00.000Z",
        ...validBody(),
      }),
    "CLIENT_AUTHORITY_FORBIDDEN"
  );
  pass("만료시간을 클라이언트가 조작할 수 없음");

  const hmacToken = rc1.mintCheckoutToken("jjn_" + "a".repeat(32), 1, SECRET);
  assert.ok(hmacToken.length >= 40);
  assert.equal(hmacToken, rc1.mintCheckoutToken("jjn_" + "a".repeat(32), 1, SECRET));
  assert.notEqual(hmacToken, rc1.mintCheckoutToken("jjn_" + "b".repeat(32), 1, SECRET));
  pass("checkoutToken이 충분히 길고 암호학적으로 안전하게 생성됨");

  const store = rc1.createMemoryStore();
  const created = await rc1.createPaymentPendingOrder(
    null,
    validBody({ clientRequestId: "web_create_basic_01" }),
    createOpts(store, { idempotencyKey: "web_create_basic_01" })
  );
  assert.equal(created.status, "PAYMENT_PENDING");
  assert.equal(created.amount, 18000);
  assert.ok(created.checkoutToken);
  assert.ok(created.orderId.startsWith("jjn_"));

  const saved = await store.get(rc1.rc1PendingKey(created.orderId), { type: "json" });
  assert.ok(saved);
  assert.equal(saved.checkoutTokenHash, rc1.hashToken(created.checkoutToken));
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "checkoutToken"), false);
  assert.ok(saved.items[0].unitPriceSnapshot);
  pass("checkoutToken 원문이 서버에 그대로 저장되지 않음");
  pass("생성된 주문 기본 상태 → PAYMENT_PENDING");

  // --- Remediation: 응답 유실 재시도 → 재개 가능 ---
  const resumed = await rc1.createPaymentPendingOrder(
    null,
    validBody({ clientRequestId: "web_create_basic_01" }),
    createOpts(store, { idempotencyKey: "web_create_basic_01" })
  );
  assert.equal(resumed.orderId, created.orderId);
  assert.equal(resumed.replay, true);
  assert.ok(resumed.checkoutToken);
  assert.equal(resumed.checkoutToken, created.checkoutToken);
  assert.equal(rc1.verifyCheckoutToken(saved, resumed.checkoutToken), true);
  const pendingAfterResume = store._keys().filter((key) => key.startsWith("rc1-pending/"));
  assert.equal(pendingAfterResume.length, 1);
  pass("첫 서버 응답 유실 후 동일 요청 재시도 → 기존 주문 재개·checkoutToken 확보");

  // --- Remediation: 동시 8요청 ---
  const concStore = rc1.createMemoryStore();
  const concKey = "web_concurrent_batch_01";
  const concBody = validBody({ clientRequestId: concKey });
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      rc1.createPaymentPendingOrder(null, concBody, createOpts(concStore, { idempotencyKey: concKey }))
    )
  );
  const orderIds = new Set(concurrent.map((row) => row.orderId));
  assert.equal(orderIds.size, 1, `expected 1 order, got ${[...orderIds].join(",")}`);
  assert.ok(concurrent.every((row) => row.checkoutToken));
  assert.ok(concurrent.every((row) => row.orderId === concurrent[0].orderId));
  const pendingConc = concStore._keys().filter((key) => key.startsWith("rc1-pending/"));
  const idemConc = concStore._keys().filter((key) => key.startsWith("rc1-idempotency/"));
  assert.equal(pendingConc.length, 1);
  assert.equal(idemConc.length, 1);
  pass("동일 idempotency 키 동시 8요청 → 단일 주문·단일 멱등 원장 수렴");

  // --- digest 충돌 ---
  const conflictStore = rc1.createMemoryStore();
  await rc1.createPaymentPendingOrder(
    null,
    validBody({ clientRequestId: "web_conflict_01", address: "세종특별자치시 주소A 12345" }),
    createOpts(conflictStore, { idempotencyKey: "web_conflict_01" })
  );
  await expectFailAsync(
    () =>
      rc1.createPaymentPendingOrder(
        null,
        validBody({ clientRequestId: "web_conflict_01", address: "세종특별자치시 주소B 67890" }),
        createOpts(conflictStore, { idempotencyKey: "web_conflict_01" })
      ),
    "IDEMPOTENCY_CONFLICT"
  );
  pass("동일 키·다른 payload → IDEMPOTENCY_CONFLICT (기존 주문 오반환 없음)");

  // --- 빈/잘못된 멱등 키 ---
  await expectFailAsync(
    () =>
      rc1.createPaymentPendingOrder(null, validBody({ clientRequestId: "" }), createOpts(rc1.createMemoryStore(), {
        idempotencyKey: "",
      })),
    "MISSING_IDEMPOTENCY_KEY"
  );
  expectFail(() => rc1.assertValidIdempotencyKey("short"), "INVALID_IDEMPOTENCY_KEY");
  expectFail(() => rc1.assertValidIdempotencyKey("bad key!!"), "INVALID_IDEMPOTENCY_KEY");
  expectFail(() => rc1.assertValidIdempotencyKey("x".repeat(200)), "INVALID_IDEMPOTENCY_KEY");
  // 정규화로 합치지 않음: 서로 다른 유효 키는 다른 저장 키
  assert.notEqual(rc1.rc1IdempotencyKey("web_alpha_01"), rc1.rc1IdempotencyKey("web_beta_02"));
  pass("빈·잘못된·과도한 idempotency 키 거절 (치환·절단 합치기 없음)");

  expectFail(
    () =>
      rc1.assertOrderPayable({
        status: "PAYMENT_PENDING",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    "ORDER_EXPIRED"
  );
  pass("만료된 주문 → 승인 불가");

  await withEnv("RC1_SERVER_ORDER", undefined, async () => {
    assert.equal(rc1.isRc1Enabled(), false);
    const disabledRes = await createOrder.handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify(validBody()),
    });
    assert.equal(disabledRes.statusCode, 503);
    assert.equal(JSON.parse(disabledRes.body).code, "RC1_DISABLED");
  });
  pass("서버 플래그 OFF · 클라 ON 가정 → create-order 503 (결제창 미개방 fail-closed)");
  pass("RC1 서버 플래그 기본 OFF 유지");

  const replayJson = JSON.stringify({ orderId: created.orderId, amount: created.amount, replay: true });
  assert.equal(replayJson.includes("checkoutToken"), false);
  assert.equal(replayJson.includes("01012345678"), false);
  pass("주소·전화번호·토큰이 재시도 메타에 불필요 노출되지 않음(성공 재개 본문만 토큰)");

  const createOrderSrc = fs.readFileSync(path.join(root, "netlify/functions/create-order.js"), "utf8");
  assert.ok(createOrderSrc.includes('console.log("create-order failed:"'));
  assert.equal(/console\.log\([^)]*phone/i.test(createOrderSrc), false);
  assert.equal(/console\.log\([^)]*address/i.test(createOrderSrc), false);
  assert.equal(/console\.log\([^)]*checkoutToken/i.test(createOrderSrc), false);
  pass("서버 로그 경로에 주소·전화번호·토큰 미노출 (소스 검사)");

  await expectFailAsync(
    () =>
      rc1.createPaymentPendingOrder(
        null,
        {
          items: [{ menuId: "jjajang", quantity: 1 }],
          utensils: "O",
          address: "세종특별자치시 조치원읍 테스트로 1",
          phone: "01012345678",
          request: "없음",
          clientRequestId: "web_below_min_01",
        },
        createOpts(rc1.createMemoryStore(), { idempotencyKey: "web_below_min_01" })
      ),
    "BELOW_MINIMUM"
  );
  pass("최소 주문금액 미달 → 주문 생성 거절 (결제창 미개방)");

  const view = rc1.publicOrderView(
    {
      orderId: "jjn_test",
      status: "PAYMENT_PENDING",
      amount: 18000,
      orderName: "짜장면 곱빼기 2개",
      expiresAt: "2026-08-05T07:30:00.000Z",
      currency: "KRW",
    },
    "token-plain"
  );
  assert.deepEqual(Object.keys(view).sort(), [
    "amount",
    "checkoutToken",
    "currency",
    "expiresAt",
    "orderId",
    "orderName",
    "status",
  ]);
  pass("공개 응답 계약 (orderId·amount·orderName·checkoutToken·expiresAt)");

  // --- 플래그 네 조합 실제 실행 ---
  const paymentConfigSrc = fs.readFileSync(path.join(root, "payment-config.js"), "utf8");
  assert.match(paymentConfigSrc, /rc1ServerOrder:\s*false/);
  assert.match(paymentConfigSrc, /YOUR_TOSS_CLIENT_KEY/);

  // OFF/OFF: 레거시 pending 허용(RC1 차단 코드 아님), create-order 503
  await withEnv("RC1_SERVER_ORDER", undefined, async () => {
    assert.equal(rc1.isRc1Enabled(), false);
    const createRes = await createOrder.handler({
      httpMethod: "POST",
      headers: { "Idempotency-Key": "web_flag_off_off" },
      body: JSON.stringify(validBody({ clientRequestId: "web_flag_off_off" })),
    });
    assert.equal(createRes.statusCode, 503);
    const pendingRes = await pendingOrder.handler({
      httpMethod: "POST",
      body: JSON.stringify({
        orderId: "legacy-1",
        order: { cart: [{ name: "x", price: 1 }], total: 1, phone: "010", address: "addr" },
      }),
    });
    assert.notEqual(JSON.parse(pendingRes.body).code, "RC1_LEGACY_BLOCKED");
  });
  pass("플래그 OFF/OFF: 레거시 허용·RC1 create 차단");

  // ON/OFF: 클라 ON은 payment-config 문서상 서버 OFF면 create 503 (실실행)
  await withEnv("RC1_SERVER_ORDER", undefined, async () => {
    const createRes = await createOrder.handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify(validBody({ clientRequestId: "web_flag_on_off1" })),
    });
    assert.equal(createRes.statusCode, 503);
    assert.equal(JSON.parse(createRes.body).code, "RC1_DISABLED");
  });
  pass("플래그 ON/OFF: 서버 거부(503)로 결제 차단");

  // OFF/ON: 서버 ON → 레거시 pending·confirm 차단
  await withEnv("RC1_SERVER_ORDER", "1", async () => {
    assert.equal(rc1.isRc1Enabled(), true);
    const pendingRes = await pendingOrder.handler({
      httpMethod: "POST",
      body: JSON.stringify({
        orderId: "legacy-2",
        order: { cart: [{ name: "x", price: 1 }], total: 1, phone: "010", address: "addr" },
      }),
    });
    assert.equal(pendingRes.statusCode, 503);
    assert.equal(JSON.parse(pendingRes.body).code, "RC1_LEGACY_BLOCKED");

    await withEnv("TOSS_SECRET_KEY", "test_sk_dummy", async () => {
      const confirmRes = await tossConfirm.handler({
        httpMethod: "POST",
        body: JSON.stringify({
          paymentKey: "pk",
          orderId: "jjn_" + "c".repeat(32),
          amount: 18000,
          order: { cart: [] },
        }),
      });
      assert.equal(confirmRes.statusCode, 503);
      assert.equal(JSON.parse(confirmRes.body).code, "RC1_LEGACY_BLOCKED");
    });
  });
  pass("플래그 OFF/ON: 레거시 pending·confirm 서버 차단");

  // ON/ON: RC1 create만 허용 (force+secret으로 원장 경로 실호출)
  await withEnv("RC1_SERVER_ORDER", "1", async () => {
    await withEnv("RC1_CHECKOUT_SECRET", SECRET, async () => {
      const onStore = rc1.createMemoryStore();
      // handler는 실제 Blobs를 쓰므로 모듈 함수로 RC1 경로 검증
      const row = await rc1.createPaymentPendingOrder(
        null,
        validBody({ clientRequestId: "web_flag_on_on_01" }),
        createOpts(onStore, { idempotencyKey: "web_flag_on_on_01" })
      );
      assert.equal(row.status, "PAYMENT_PENDING");
      assert.ok(row.checkoutToken);
      const pendingRes = await pendingOrder.handler({
        httpMethod: "POST",
        body: JSON.stringify({ orderId: "legacy-3", order: { cart: [{ name: "x" }] } }),
      });
      assert.equal(JSON.parse(pendingRes.body).code, "RC1_LEGACY_BLOCKED");
    });
  });
  pass("플래그 ON/ON: RC1 주문만 허용·레거시 차단");

  const orderHtml = fs.readFileSync(path.join(root, "order.html"), "utf8");
  assert.match(orderHtml, /getOrCreateClientRequestId/);
  assert.match(orderHtml, /레거시 경로로 절대 폴백하지 않는다/);
  assert.match(orderHtml, /create-order \/ checkoutToken 경로와 혼합하지 않는다/);
  assert.equal(/createServerPendingOrder[\s\S]{0,400}catch[\s\S]{0,200}savePendingOrder/.test(orderHtml), false);
  pass("브라우저 재시도 clientRequestId 재사용·레거시 폴백 없음 (코드 계약)");

  const failed = results.filter((row) => !row.ok);
  assert.equal(failed.length, 0);
  console.log(`\nRC1 Slice 1 verify gate: PASS (${results.length} scenarios)`);
}

run().catch((error) => {
  console.error("RC1 Slice 1 verify gate: FAIL", error);
  process.exit(1);
});
