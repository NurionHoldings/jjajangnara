const {
  deletePendingOrder,
  getPendingOrder,
  savePendingOrder,
} = require("./_orders");
const { isRc1Enabled } = require("./_rc1-orders");

const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: responseHeaders,
    body: JSON.stringify(data),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: responseHeaders, body: "" };
  }

  try {
    if (event.httpMethod === "POST") {
      // fail-closed: 서버 RC1 ON이면 레거시 대기주문 생성 차단 (클라 캐시 OFF여도 실결제 경로 차단)
      if (isRc1Enabled()) {
        return json(503, {
          message: "RC1 서버 주문이 활성화되어 레거시 대기주문을 받을 수 없습니다.",
          code: "RC1_LEGACY_BLOCKED",
        });
      }
      const body = JSON.parse(event.body || "{}");
      const orderId = String(body.orderId || "").trim();
      if (!orderId || !body.order) {
        return json(400, { message: "orderId와 order가 필요합니다." });
      }
      const pending = await savePendingOrder(event, orderId, body.order);
      return json(200, { ok: true, orderId: pending.orderId });
    }

    if (event.httpMethod === "GET") {
      const orderId = String(event.queryStringParameters?.orderId || "").trim();
      if (!orderId) {
        return json(400, { message: "orderId가 필요합니다." });
      }
      const pending = await getPendingOrder(event, orderId);
      if (!pending) {
        return json(404, { message: "대기 주문 정보를 찾지 못했습니다." });
      }
      return json(200, { order: pending });
    }

    if (event.httpMethod === "DELETE") {
      const orderId = String(
        event.queryStringParameters?.orderId ||
          JSON.parse(event.body || "{}").orderId ||
          ""
      ).trim();
      if (!orderId) {
        return json(400, { message: "orderId가 필요합니다." });
      }
      await deletePendingOrder(event, orderId);
      return json(200, { ok: true });
    }

    return json(405, { message: "Method Not Allowed" });
  } catch (error) {
    return json(500, { message: error.message || "대기 주문 처리 오류" });
  }
};
