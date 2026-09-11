const { deletePendingOrder, savePaidOrder } = require("./_orders");
const { isRc1Enabled } = require("./_rc1-orders");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  const secretKey = process.env.TOSS_SECRET_KEY;

  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "TOSS_SECRET_KEY is not configured." }),
    };
  }

  try {
    const { paymentKey, orderId, amount, order } = JSON.parse(event.body || "{}");

    if (!paymentKey || !orderId || typeof amount === "undefined" || !order) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "paymentKey, orderId, amount, order are required." }),
      };
    }

    // fail-closed: 서버 RC1 ON이면 레거시(클라이언트 order 본문) 승인 경로 전면 차단 (Slice 2 전)
    if (isRc1Enabled()) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          message: "RC1 모드에서는 레거시 toss-confirm 경로를 사용할 수 없습니다.",
          code: "RC1_LEGACY_BLOCKED",
        }),
      };
    }

    const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": orderId,
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          message: result.message || "Payment confirmation failed.",
          code: result.code || "TOSS_CONFIRM_FAILED",
        }),
      };
    }

    const paymentData = {
      paymentKey: result.paymentKey,
      orderId: result.orderId,
      method: result.method,
      status: result.status,
      totalAmount: result.totalAmount,
      approvedAt: result.approvedAt,
    };
    const posOrder = await savePaidOrder(event, order, paymentData);
    try {
      await deletePendingOrder(event, orderId);
    } catch (cleanupError) {
      console.log("pending cleanup skipped:", cleanupError.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ...paymentData,
        dispatchedToPos: Boolean(posOrder),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error.message || "Unknown server error",
      }),
    };
  }
};
