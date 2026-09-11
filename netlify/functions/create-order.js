/**
 * POST /.netlify/functions/create-order
 * RC1 Slice 1 — 서버 권위 주문 생성
 */
"use strict";

const { createPaymentPendingOrder, isRc1Enabled } = require("./_rc1-orders");

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, data) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(data),
  };
}

function sanitizePublicError(error) {
  const body = {
    message: error.message || "주문 생성 실패",
    code: error.code || "ORDER_CREATE_FAILED",
  };
  if (error.payload && typeof error.payload === "object") {
    const allowed = ["orderId", "status", "amount", "orderName", "expiresAt", "currency", "replay"];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(error.payload, key)) {
        body[key] = error.payload[key];
      }
    }
  }
  return body;
}

function publicSuccessBody(created) {
  return {
    orderId: created.orderId,
    status: created.status,
    amount: created.amount,
    orderName: created.orderName,
    checkoutToken: created.checkoutToken,
    expiresAt: created.expiresAt,
    currency: created.currency,
    ...(created.replay ? { replay: true } : {}),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { message: "Method Not Allowed", code: "METHOD_NOT_ALLOWED" });
  }

  if (!isRc1Enabled()) {
    return json(503, {
      message: "RC1 서버 주문 기능이 비활성화되어 있습니다.",
      code: "RC1_DISABLED",
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const idempotencyKey =
      event.headers?.["idempotency-key"] ||
      event.headers?.["Idempotency-Key"] ||
      body.clientRequestId ||
      "";

    const created = await createPaymentPendingOrder(event, body, {
      idempotencyKey: String(idempotencyKey || "").trim(),
    });

    const statusCode = created.replay ? 200 : 201;
    return json(statusCode, publicSuccessBody(created));
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    console.log("create-order failed:", error.code || "ERROR", statusCode);
    return json(statusCode, sanitizePublicError(error));
  }
};
