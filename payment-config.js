window.JJAJANGNARA_PAYMENT_CONFIG = {
  tossClientKey: "YOUR_TOSS_CLIENT_KEY",
  siteUrl: "https://짜장나라.com",
  successPath: "/payment-success.html",
  failPath: "/payment-fail.html",
  /**
   * RC1 Slice 1 — 서버 권위 주문 생성 경로
   * 기본 OFF. 켜려면 true 로 두고 Netlify env 도 함께 설정한다:
   *   RC1_SERVER_ORDER=1
   *   RC1_CHECKOUT_SECRET=<충분히 긴 랜덤 비밀>
   * 혼합 배포 금지: 클라만 ON / 서버만 ON 상태로 실결제하지 말 것.
   * 서버 ON이면 레거시 pending-order·toss-confirm 은 서버에서 거절한다.
   */
  rc1ServerOrder: false,
};