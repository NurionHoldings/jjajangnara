const { deletePendingOrder, savePaidOrder } = require("./_orders");
const {
  isRc1Enabled,
  markRc1OrderPaid,
  prepareRc1Confirm,
} = require("./_rc1-orders");

function json(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(data),
  };
}

async function confirmWithToss(secretKey, paymentKey, orderId, amount) {
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
  return { response, result };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { message: "Method Not Allowed" });
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return json(500, { message: "TOSS_SECRET_KEY is not configured." });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { paymentKey, orderId, amount, order, checkoutToken } = body;

    if (!paymentKey || !orderId || typeof amount === "undefined") {
      return json(400, {
        message: "paymentKey, orderId, amount are required.",
        code: "CONFIRM_REQUIRED",
      });
    }

    // B1: 서버 RC1 ON → 서버 원장 + checkoutToken 승인만 허용 (클라이언트 order 비신뢰)
    if (isRc1Enabled()) {
      let prepared;
      try {
        prepared = await prepareRc1Confirm(event, {
          orderId,
          amount,
          checkoutToken,
        });
      } catch (error) {
        const statusCode = Number(error.statusCode) || 500;
        return json(statusCode, {
          message: error.message || "RC1 승인 준비 실패",
          code: error.code || "RC1_CONFIRM_FAILED",
        });
      }

      if (prepared.alreadyPaid) {
        const payment = prepared.record.payment || {};
        return json(200, {
          paymentKey: payment.paymentKey || paymentKey,
          orderId: prepared.record.orderId,
          method: payment.method || "카드",
          status: payment.status || "DONE",
          totalAmount: payment.totalAmount || prepared.confirmAmount,
          approvedAt: payment.approvedAt || prepared.record.paidAt,
          dispatchedToPos: true,
          replay: true,
          source: "rc1",
          orderSummary: {
            phone: prepared.orderPayload.phone,
            address: prepared.orderPayload.address,
            orderName: prepared.orderPayload.orderName,
            total: prepared.orderPayload.total,
          },
        });
      }

      const { response, result } = await confirmWithToss(
        secretKey,
        paymentKey,
        orderId,
        prepared.confirmAmount
      );

      if (!response.ok) {
        return json(response.status, {
          message: result.message || "Payment confirmation failed.",
          code: result.code || "TOSS_CONFIRM_FAILED",
        });
      }

      const paymentData = {
        paymentKey: result.paymentKey,
        orderId: result.orderId,
        method: result.method,
        status: result.status,
        totalAmount: result.totalAmount,
        approvedAt: result.approvedAt,
      };

      if (Number(paymentData.totalAmount) !== Number(prepared.confirmAmount)) {
        return json(409, {
          message: "토스 승인 금액이 서버 원장과 일치하지 않습니다.",
          code: "TOSS_AMOUNT_MISMATCH",
        });
      }

      await markRc1OrderPaid(event, orderId, paymentData);
      const posOrder = await savePaidOrder(event, prepared.orderPayload, paymentData);

      return json(200, {
        ...paymentData,
        dispatchedToPos: Boolean(posOrder),
        source: "rc1",
        orderSummary: {
          phone: prepared.orderPayload.phone,
          address: prepared.orderPayload.address,
          orderName: prepared.orderPayload.orderName,
          total: prepared.orderPayload.total,
        },
      });
    }

    // 레거시 경로 (RC1 OFF만)
    if (!order) {
      return json(400, {
        message: "paymentKey, orderId, amount, order are required.",
        code: "CONFIRM_REQUIRED",
      });
    }

    const { response, result } = await confirmWithToss(secretKey, paymentKey, orderId, amount);

    if (!response.ok) {
      return json(response.status, {
        message: result.message || "Payment confirmation failed.",
        code: result.code || "TOSS_CONFIRM_FAILED",
      });
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

    return json(200, {
      ...paymentData,
      dispatchedToPos: Boolean(posOrder),
      source: "legacy",
    });
  } catch (error) {
    const statusCode = Number(error.statusCode) || 500;
    return json(statusCode, {
      message: error.message || "Unknown server error",
      code: error.code || "CONFIRM_ERROR",
    });
  }
};
