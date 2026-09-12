/**
 * RC1 Slice 1 — 서버 권위 주문 생성 (가격 재계산 + PAYMENT_PENDING)
 * Remediation: 원자적 멱등 클레임, digest 충돌 거절, HMAC checkout 재개, 레거시 fail-closed 지원
 */
"use strict";

const crypto = require("crypto");
const { connectLambda, getStore } = require("@netlify/blobs");
const catalog = require("./_menu-catalog");

const STORE_NAME = "jjajangnara-pos-orders";
const RC1_PENDING_PREFIX = "rc1-pending/";
const RC1_IDEMPOTENCY_PREFIX = "rc1-idempotency/";
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._:-]{8,128}$/;
const CLAIM_TTL_MS = 15 * 1000;
const CLAIM_WAIT_MS = 50;
const CLAIM_WAIT_ATTEMPTS = 40;

function getOrderStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

function rc1PendingKey(orderId) {
  const safe = String(orderId || "");
  if (!/^jjn_[a-f0-9]{32}$/.test(safe)) {
    throw HttpError(400, "orderId 형식이 올바르지 않습니다.", "INVALID_ORDER_ID");
  }
  return `${RC1_PENDING_PREFIX}${safe}`;
}

function rc1IdempotencyKey(key) {
  // 검증된 키만 사용. 잘라내거나 _ 치환으로 서로 다른 키를 합치지 않는다.
  return `${RC1_IDEMPOTENCY_PREFIX}${key}`;
}

function assertValidIdempotencyKey(raw) {
  const key = String(raw || "").trim();
  if (!key) {
    throw HttpError(400, "Idempotency-Key / clientRequestId가 필요합니다.", "MISSING_IDEMPOTENCY_KEY");
  }
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw HttpError(
      400,
      "Idempotency-Key 형식이 올바르지 않습니다.",
      "INVALID_IDEMPOTENCY_KEY"
    );
  }
  return key;
}

function isRc1Enabled() {
  const raw = String(process.env.RC1_SERVER_ORDER || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function createOrderId() {
  return `jjn_${crypto.randomBytes(16).toString("hex")}`;
}

function resolveCheckoutSecret(options) {
  if (options && options.checkoutSecret) {
    return String(options.checkoutSecret);
  }
  const fromEnv = String(process.env.RC1_CHECKOUT_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  // 테스트 force 경로에서도 결정적 재개를 위해 고정 시드를 쓰지 않고 실패시킨다.
  // 운영에서는 RC1_CHECKOUT_SECRET 필수.
  throw HttpError(
    503,
    "RC1_CHECKOUT_SECRET이 설정되지 않아 주문을 생성할 수 없습니다.",
    "CHECKOUT_SECRET_MISSING"
  );
}

/** 서버 비밀 기반 결정적 토큰 — 원문 저장 없이 재발급 가능 */
function mintCheckoutToken(orderId, version, secret) {
  const msg = `jjn.checkout.v1|${orderId}|${Number(version) || 1}`;
  return crypto.createHmac("sha256", secret).update(msg).digest("base64url");
}

function createCheckoutToken() {
  // 레거시 테스트 호환 — 무작위 토큰 (HMAC 경로가 기본)
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function HttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || "BAD_REQUEST";
  return error;
}

function assertNoClientAuthorityFields(body) {
  if (!body || typeof body !== "object") return;

  const topForbidden = [
    "price",
    "total",
    "amount",
    "unitPrice",
    "lineTotal",
    "name",
    "orderName",
    "menuName",
    "orderId",
    "expiresAt",
    "checkoutToken",
    "checkoutTokenHash",
    "status",
    "currency",
    "version",
  ];
  for (const key of topForbidden) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw HttpError(400, `클라이언트 ${key} 필드는 허용되지 않습니다.`, "CLIENT_AUTHORITY_FORBIDDEN");
    }
  }

  const itemForbidden = [
    "price",
    "total",
    "amount",
    "unitPrice",
    "lineTotal",
    "name",
    "menuName",
    "menuNameSnapshot",
    "orderName",
  ];
  if (Array.isArray(body.items)) {
    body.items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      for (const key of itemForbidden) {
        if (Object.prototype.hasOwnProperty.call(item, key)) {
          throw HttpError(
            400,
            `items[${index}].${key} 필드는 허용되지 않습니다.`,
            "CLIENT_AUTHORITY_FORBIDDEN"
          );
        }
      }
    });
  }
}

function assertNoClientPrices(body) {
  return assertNoClientAuthorityFields(body);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function normalizeItemsForDigest(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item.setId) {
      return {
        setId: String(item.setId || "").trim(),
        quantity: Number(item.quantity == null ? 1 : item.quantity),
        mains: Array.isArray(item.mains)
          ? item.mains.map((main) => ({
              mainId: String(main?.mainId || "").trim(),
              optionIds: uniqueOptionIds(main?.optionIds).slice().sort(),
            }))
          : [],
      };
    }
    return {
      menuId: String(item.menuId || "").trim(),
      quantity: Number(item.quantity),
      optionIds: uniqueOptionIds(item.optionIds).slice().sort(),
    };
  });
}

function buildRequestDigest(parts) {
  const payload = {
    items: normalizeItemsForDigest(parts.items),
    utensils: String(parts.utensils || "O").trim().slice(0, 10) || "O",
    address: String(parts.address || "").trim(),
    phone: String(parts.phone || "").replace(/\D/g, ""),
    request: String(parts.request || "없음").trim().slice(0, 500) || "없음",
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/**
 * 동시성 안전 메모리 스토어 — onlyIfNew 체크와 set이 await 없이 한 틱에서 완료된다.
 */
function createMemoryStore(seed) {
  const map = new Map();
  if (seed && typeof seed === "object") {
    for (const [key, value] of Object.entries(seed)) {
      map.set(key, value);
    }
  }
  return {
    async get(key, opts) {
      if (!map.has(key)) return null;
      const value = map.get(key);
      if (opts && opts.type === "json") {
        return JSON.parse(JSON.stringify(value));
      }
      return value;
    },
    async setJSON(key, value, opts) {
      opts = opts || {};
      if (opts.onlyIfNew && map.has(key)) {
        return { modified: false };
      }
      map.set(key, JSON.parse(JSON.stringify(value)));
      return { modified: true };
    },
    async delete(key) {
      map.delete(key);
    },
    _keys() {
      return [...map.keys()];
    },
  };
}

async function setJsonIfNew(store, key, value) {
  if (typeof store.setJSON !== "function") {
    throw HttpError(500, "스토어가 setJSON을 지원하지 않습니다.", "STORE_UNSUPPORTED");
  }
  const result = await store.setJSON(key, value, { onlyIfNew: true });
  // H3: modified 불리언이 없으면 성공으로 추정하지 않는다 (fail-closed).
  if (!result || typeof result.modified !== "boolean") {
    throw HttpError(
      500,
      "스토어가 onlyIfNew(modified)를 지원하지 않습니다.",
      "STORE_UNSUPPORTED"
    );
  }
  return result.modified;
}

async function deleteStoreKey(store, key) {
  if (typeof store.delete === "function") {
    await store.delete(key);
    return;
  }
  throw HttpError(500, "스토어가 delete를 지원하지 않습니다.", "STORE_UNSUPPORTED");
}

function isClaimStale(ref) {
  if (!ref || ref.state !== "claimed") return false;
  const created = Date.parse(ref.createdAt || "");
  if (!Number.isFinite(created)) return true;
  return Date.now() - created > CLAIM_TTL_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!/^01[016789]\d{7,8}$/.test(digits)) {
    throw HttpError(400, "연락처 형식이 올바르지 않습니다.", "INVALID_PHONE");
  }
  return digits;
}

function normalizeAddress(address) {
  const value = String(address || "").trim();
  if (value.length < 5 || value.length > 300) {
    throw HttpError(400, "배달 주소 길이가 올바르지 않습니다.", "INVALID_ADDRESS");
  }
  return value;
}

function normalizeQuantity(raw, label) {
  if (typeof raw === "string" && !/^\d+$/.test(raw.trim())) {
    throw HttpError(400, `${label} 수량이 올바르지 않습니다.`, "INVALID_QUANTITY");
  }
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty < 1 || qty > catalog.MAX_LINE_QUANTITY) {
    throw HttpError(400, `${label} 수량은 1~${catalog.MAX_LINE_QUANTITY}만 허용됩니다.`, "INVALID_QUANTITY");
  }
  return qty;
}

function uniqueOptionIds(optionIds) {
  if (optionIds == null) return [];
  if (!Array.isArray(optionIds)) {
    throw HttpError(400, "optionIds는 배열이어야 합니다.", "INVALID_OPTIONS");
  }
  const list = optionIds.map((id) => String(id || "").trim()).filter(Boolean);
  return [...new Set(list)];
}

function priceSingleItem(raw) {
  const menuId = String(raw.menuId || "").trim();
  if (!menuId) {
    throw HttpError(400, "menuId가 필요합니다.", "MISSING_MENU_ID");
  }
  if (raw.setId) {
    throw HttpError(400, "단품 항목에 setId를 함께 보낼 수 없습니다.", "AMBIGUOUS_ITEM");
  }

  const menu = catalog.getMenu(menuId);
  if (!menu) {
    throw HttpError(400, `존재하지 않는 메뉴입니다: ${menuId}`, "UNKNOWN_MENU");
  }

  const quantity = normalizeQuantity(raw.quantity, menu.name);
  const optionIds = uniqueOptionIds(raw.optionIds);
  const options = optionIds.map((optionId) => {
    if (!menu.options.includes(optionId)) {
      throw HttpError(400, `${menu.name}에 허용되지 않는 옵션입니다: ${optionId}`, "UNKNOWN_OPTION");
    }
    const option = catalog.getOption(optionId);
    if (!option) {
      throw HttpError(400, `존재하지 않는 옵션입니다: ${optionId}`, "UNKNOWN_OPTION");
    }
    return {
      optionId: option.id,
      nameSnapshot: option.name,
      priceSnapshot: option.price,
    };
  });

  const optionTotal = options.reduce((sum, option) => sum + option.priceSnapshot, 0);
  const unitPriceSnapshot = menu.unitPrice;
  const lineTotal = (unitPriceSnapshot + optionTotal) * quantity;

  return {
    kind: "single",
    menuId: menu.id,
    menuNameSnapshot: menu.name,
    unitPriceSnapshot,
    options,
    quantity,
    lineTotal,
  };
}

function priceSetItem(raw) {
  const setId = String(raw.setId || "").trim();
  if (!setId) {
    throw HttpError(400, "setId가 필요합니다.", "MISSING_SET_ID");
  }
  if (raw.menuId) {
    throw HttpError(400, "세트 항목에 menuId를 함께 보낼 수 없습니다.", "AMBIGUOUS_ITEM");
  }

  const set = catalog.getSet(setId);
  if (!set) {
    throw HttpError(400, `존재하지 않는 세트입니다: ${setId}`, "UNKNOWN_SET");
  }

  const quantity = normalizeQuantity(raw.quantity == null ? 1 : raw.quantity, set.name);
  if (!Array.isArray(raw.mains) || raw.mains.length !== set.pick) {
    throw HttpError(400, `${set.name}은 메인 ${set.pick}개가 필요합니다.`, "INVALID_SET_MAINS");
  }

  const mains = raw.mains.map((main, index) => {
    const mainId = String(main?.mainId || "").trim();
    const setMain = catalog.getSetMain(mainId);
    if (!setMain) {
      throw HttpError(400, `존재하지 않는 세트 메인입니다: ${mainId || `(index ${index})`}`, "UNKNOWN_SET_MAIN");
    }
    const optionIds = uniqueOptionIds(main.optionIds);
    const options = optionIds.map((optionId) => {
      const normalizedId = optionId === "large" ? "double" : optionId;
      if (normalizedId !== "double" && normalizedId !== "sauce") {
        throw HttpError(400, `세트 메인에 허용되지 않는 옵션입니다: ${optionId}`, "UNKNOWN_OPTION");
      }
      const option = catalog.getOption(normalizedId);
      if (!option) {
        throw HttpError(400, `존재하지 않는 옵션입니다: ${optionId}`, "UNKNOWN_OPTION");
      }
      return {
        optionId: option.id,
        nameSnapshot: option.name,
        priceSnapshot: option.price,
      };
    });
    const optionTotal = options.reduce((sum, option) => sum + option.priceSnapshot, 0);
    return {
      mainId: setMain.id,
      nameSnapshot: setMain.name,
      extraSnapshot: setMain.extra,
      options,
      lineExtra: setMain.extra + optionTotal,
    };
  });

  const mainsExtra = mains.reduce((sum, main) => sum + main.lineExtra, 0);
  const unitPriceSnapshot = set.basePrice + mainsExtra;
  const lineTotal = unitPriceSnapshot * quantity;

  return {
    kind: "set",
    setId: set.id,
    menuNameSnapshot: set.name,
    tangNameSnapshot: set.tangName,
    unitPriceSnapshot,
    basePriceSnapshot: set.basePrice,
    mains,
    quantity,
    lineTotal,
  };
}

function priceItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw HttpError(400, "주문 항목이 비어 있습니다.", "EMPTY_ITEMS");
  }
  if (items.length > catalog.MAXIMUM_ITEMS) {
    throw HttpError(400, "주문 항목 수가 너무 많습니다.", "TOO_MANY_ITEMS");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw HttpError(400, `items[${index}] 형식이 올바르지 않습니다.`, "INVALID_ITEM");
    }
    if (item.setId) return priceSetItem(item);
    return priceSingleItem(item);
  });
}

function buildOrderName(pricedItems) {
  if (pricedItems.length === 0) return "짜장나라 주문";
  const first = pricedItems[0];
  const label =
    first.kind === "set"
      ? first.menuNameSnapshot
      : `${first.menuNameSnapshot}${first.options?.length ? " " + first.options.map((o) => o.nameSnapshot).join(" ") : ""}${
          first.quantity > 1 ? ` ${first.quantity}개` : ""
        }`;
  if (pricedItems.length === 1) return label.slice(0, 100);
  return `${label} 외 ${pricedItems.length - 1}건`.slice(0, 100);
}

function publicOrderView(record, checkoutToken, extra) {
  const view = {
    orderId: record.orderId,
    status: record.status,
    amount: record.amount,
    orderName: record.orderName,
    checkoutToken,
    expiresAt: record.expiresAt,
    currency: record.currency,
  };
  if (extra && extra.replay) {
    view.replay = true;
  }
  if (extra && extra.created) {
    view.created = true;
  }
  return view;
}

async function loadPayableOrder(store, orderId) {
  const record = await store.get(rc1PendingKey(orderId), { type: "json" });
  return assertOrderPayable(record);
}

async function resumeExistingOrder(store, orderId, secret, extra) {
  const record = await loadPayableOrder(store, orderId);
  const token = mintCheckoutToken(record.orderId, record.version, secret);
  if (!verifyCheckoutToken(record, token)) {
    throw HttpError(500, "체크아웃 토큰 재발급에 실패했습니다.", "TOKEN_RESUME_FAILED");
  }
  return publicOrderView(record, token, { replay: true, ...(extra || {}) });
}

async function waitForClaimedOrder(store, orderId, secret) {
  for (let attempt = 0; attempt < CLAIM_WAIT_ATTEMPTS; attempt += 1) {
    const record = await store.get(rc1PendingKey(orderId), { type: "json" });
    if (record && record.status === "PAYMENT_PENDING") {
      if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
        throw HttpError(409, "만료된 주문입니다.", "ORDER_EXPIRED");
      }
      const token = mintCheckoutToken(record.orderId, record.version, secret);
      return publicOrderView(record, token, { replay: true });
    }
    if (record && record.status === "PAID") {
      throw HttpError(409, "이미 결제된 주문입니다.", "ALREADY_PAID");
    }
    await sleep(CLAIM_WAIT_MS);
  }
  throw HttpError(503, "동일 주문 생성 처리 중입니다. 잠시 후 다시 시도해 주세요.", "ORDER_CLAIM_PENDING");
}

function rc1RecordToOrderPayload(record) {
  return {
    cart: (record.items || []).map((item) => ({
      type: item.kind === "set" ? "set" : "single",
      id: item.menuId || item.setId || "",
      name: item.menuNameSnapshot || "메뉴",
      detail:
        item.kind === "set"
          ? `${item.tangNameSnapshot || ""} / ${(item.mains || [])
              .map((main) => main.nameSnapshot)
              .join(", ")}`
          : `수량 ${item.quantity}개`,
      price: Number(item.lineTotal) || 0,
    })),
    total: Number(record.amount),
    utensils: record.utensils,
    address: record.address,
    phone: record.phone,
    request: record.request,
    date: record.createdAt,
    orderName: record.orderName,
  };
}

async function createPaymentPendingOrder(event, body, options) {
  options = options || {};
  if (!isRc1Enabled() && !options.force) {
    throw HttpError(503, "RC1 서버 주문 기능이 비활성화되어 있습니다.", "RC1_DISABLED");
  }

  assertNoClientAuthorityFields(body);

  const clientRequestId = assertValidIdempotencyKey(body.clientRequestId || options.idempotencyKey);
  const store = options.store || getOrderStore(event);
  const secret = resolveCheckoutSecret(options);

  const utensils = String(body.utensils || "O").trim().slice(0, 10) || "O";
  const phone = normalizePhone(body.phone);
  const address = normalizeAddress(body.address);
  const request = String(body.request || "없음").trim().slice(0, 500) || "없음";

  const digest = buildRequestDigest({
    items: body.items,
    utensils,
    address,
    phone,
    request,
  });

  const pricedItems = priceItems(body.items);
  const amount = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  if (amount < catalog.MINIMUM_ORDER_AMOUNT) {
    throw HttpError(
      400,
      `최소 주문금액은 ${catalog.MINIMUM_ORDER_AMOUNT}원입니다.`,
      "BELOW_MINIMUM"
    );
  }

  const idemKey = rc1IdempotencyKey(clientRequestId);
  let orderId = createOrderId();
  let claimed = false;

  for (let attempt = 0; attempt < 3 && !claimed; attempt += 1) {
    orderId = createOrderId();
    const claim = {
      state: "claimed",
      digest,
      orderId,
      createdAt: new Date().toISOString(),
    };
    claimed = await setJsonIfNew(store, idemKey, claim);
    if (claimed) break;

    const existingRef = await store.get(idemKey, { type: "json" });
    if (!existingRef || !existingRef.orderId) {
      throw HttpError(409, "멱등 원장이 손상되었습니다.", "IDEMPOTENCY_CORRUPT");
    }
    if (existingRef.digest && existingRef.digest !== digest) {
      throw HttpError(
        409,
        "동일 Idempotency-Key로 다른 주문 내용이 이미 등록되어 있습니다.",
        "IDEMPOTENCY_CONFLICT"
      );
    }
    if (existingRef.state === "ready") {
      return resumeExistingOrder(store, existingRef.orderId, secret);
    }
    if (existingRef.state === "claimed" && isClaimStale(existingRef)) {
      // H1: stale claim 회수 후 재클레임
      try {
        await deleteStoreKey(store, idemKey);
      } catch (_) {
        /* continue wait path if delete unsupported in rare hosts */
      }
      continue;
    }
    try {
      return await waitForClaimedOrder(store, existingRef.orderId, secret);
    } catch (waitError) {
      if (waitError.code === "ORDER_CLAIM_PENDING" && isClaimStale(existingRef)) {
        try {
          await deleteStoreKey(store, idemKey);
          continue;
        } catch (_) {
          throw waitError;
        }
      }
      throw waitError;
    }
  }

  if (!claimed) {
    throw HttpError(503, "주문 클레임을 확보하지 못했습니다. 다시 시도해 주세요.", "ORDER_CLAIM_FAILED");
  }

  const version = 1;
  const checkoutToken = mintCheckoutToken(orderId, version, secret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + catalog.ORDER_TTL_MS).toISOString();

  const record = {
    orderId,
    status: "PAYMENT_PENDING",
    items: pricedItems,
    amount,
    currency: "KRW",
    orderName: buildOrderName(pricedItems),
    utensils,
    address,
    phone,
    request,
    requestDigest: digest,
    checkoutTokenHash: hashToken(checkoutToken),
    clientRequestId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
    version,
    source: "rc1-create-order",
  };

  if (Object.prototype.hasOwnProperty.call(record, "checkoutToken")) {
    throw HttpError(500, "토큰 원문 저장이 감지되어 주문을 중단합니다.", "TOKEN_PLAINTEXT_FORBIDDEN");
  }

  let pendingCreated = false;
  try {
    pendingCreated = await setJsonIfNew(store, rc1PendingKey(orderId), record);
    if (!pendingCreated) {
      await deleteStoreKey(store, idemKey);
      throw HttpError(500, "주문번호 충돌로 생성을 중단했습니다.", "ORDER_ID_COLLISION");
    }
    await store.setJSON(idemKey, {
      state: "ready",
      digest,
      orderId,
      createdAt: record.createdAt,
    });
  } catch (error) {
    // H1: 생성 실패 시 클레임 롤백 (충돌 시 이미 삭제했을 수 있음)
    if (error.code !== "ORDER_ID_COLLISION") {
      try {
        await deleteStoreKey(store, idemKey);
      } catch (_) {
        /* ignore */
      }
      if (pendingCreated) {
        try {
          await deleteStoreKey(store, rc1PendingKey(orderId));
        } catch (_) {
          /* ignore */
        }
      }
    }
    throw error;
  }

  return publicOrderView(record, checkoutToken, { created: true });
}

/**
 * RC1 서버 원장 기준 토스 승인 (클라이언트 order/amount 비신뢰)
 */
async function prepareRc1Confirm(event, body, options) {
  options = options || {};
  const orderId = String(body.orderId || "").trim();
  const checkoutToken = String(body.checkoutToken || "").trim();
  const clientAmount = Number(body.amount);

  if (!orderId || !checkoutToken || !Number.isFinite(clientAmount)) {
    throw HttpError(400, "orderId, amount, checkoutToken이 필요합니다.", "RC1_CONFIRM_REQUIRED");
  }

  const secret = resolveCheckoutSecret(options);
  const store = options.store || getOrderStore(event);

  const record = await getRc1PendingOrder(event, orderId, { store });
  if (!record) {
    throw HttpError(404, "RC1 주문을 찾을 수 없습니다.", "ORDER_NOT_FOUND");
  }

  if (record.status === "PAID") {
    return {
      alreadyPaid: true,
      record,
      orderPayload: rc1RecordToOrderPayload(record),
      confirmAmount: Number(record.amount),
    };
  }

  assertOrderPayable(record);
  if (!verifyCheckoutToken(record, checkoutToken)) {
    throw HttpError(403, "checkoutToken이 유효하지 않습니다.", "INVALID_CHECKOUT_TOKEN");
  }
  if (Number(record.amount) !== clientAmount) {
    throw HttpError(409, "결제 금액이 서버 원장과 일치하지 않습니다.", "AMOUNT_MISMATCH");
  }

  return {
    alreadyPaid: false,
    record,
    orderPayload: rc1RecordToOrderPayload(record),
    confirmAmount: Number(record.amount),
  };
}

async function markRc1OrderPaid(event, orderId, paymentData, options) {
  options = options || {};
  const store = options.store || getOrderStore(event);
  const record = await getRc1PendingOrder(event, orderId, { store });
  if (!record) {
    throw HttpError(404, "RC1 주문을 찾을 수 없습니다.", "ORDER_NOT_FOUND");
  }
  if (record.status === "PAID") {
    return record;
  }
  const next = {
    ...record,
    status: "PAID",
    updatedAt: new Date().toISOString(),
    paidAt: paymentData.approvedAt || new Date().toISOString(),
    payment: {
      paymentKey: paymentData.paymentKey,
      method: paymentData.method,
      status: paymentData.status,
      approvedAt: paymentData.approvedAt || new Date().toISOString(),
      totalAmount: paymentData.totalAmount,
    },
  };
  if (Object.prototype.hasOwnProperty.call(next, "checkoutToken")) {
    delete next.checkoutToken;
  }
  await store.setJSON(`${RC1_PENDING_PREFIX}${orderId}`, next);
  return next;
}

async function getRc1PendingOrder(event, orderId, options) {
  const store = (options && options.store) || getOrderStore(event);
  const safe = String(orderId || "");
  if (!/^jjn_[a-f0-9]{32}$/.test(safe)) {
    return null;
  }
  return store.get(`${RC1_PENDING_PREFIX}${safe}`, { type: "json" });
}

function verifyCheckoutToken(record, token) {
  if (!record || !token) return false;
  const expected = String(record.checkoutTokenHash || "");
  const actual = hashToken(token);
  if (!expected || expected.length !== actual.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}

function assertOrderPayable(record) {
  if (!record) {
    throw HttpError(404, "주문을 찾을 수 없습니다.", "ORDER_NOT_FOUND");
  }
  if (record.status !== "PAYMENT_PENDING") {
    throw HttpError(409, "결제 가능한 상태가 아닙니다.", "INVALID_STATUS");
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    throw HttpError(409, "만료된 주문입니다.", "ORDER_EXPIRED");
  }
  return record;
}

module.exports = {
  HttpError,
  assertNoClientAuthorityFields,
  assertNoClientPrices,
  assertOrderPayable,
  assertValidIdempotencyKey,
  buildRequestDigest,
  createCheckoutToken,
  createMemoryStore,
  createOrderId,
  createPaymentPendingOrder,
  getRc1PendingOrder,
  hashToken,
  isClaimStale,
  isRc1Enabled,
  markRc1OrderPaid,
  mintCheckoutToken,
  prepareRc1Confirm,
  priceItems,
  publicOrderView,
  rc1IdempotencyKey,
  rc1PendingKey,
  rc1RecordToOrderPayload,
  setJsonIfNew,
  verifyCheckoutToken,
};
