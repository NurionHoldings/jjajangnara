# 토스페이먼츠 결제 설정

배포 전 아래 값을 실제 키로 교체하세요.

```js
window.JJAJANGNARA_PAYMENT_CONFIG = {
  tossClientKey: "test_ck_...", // 또는 live_ck_...
  siteUrl: "https://짜장나라.com",
  successPath: "/payment-success.html",
  failPath: "/payment-fail.html",
};
```

Netlify Environment Variables에도 반드시 등록:

- `TOSS_SECRET_KEY` — 토스 시크릿 키 (`test_sk_...` / `live_sk_...`)
- `POS_API_TOKEN` — 포스·관리자 동기화용 임의 토큰(32자 이상 권장)
- `RC1_SERVER_ORDER` — RC1 서버 주문 플래그 (`1`/`true` 시 ON, 기본 미설정=OFF)
- `RC1_CHECKOUT_SECRET` — RC1 checkoutToken HMAC 비밀(충분히 긴 랜덤). RC1 ON 시 필수

`payment-config.js`의 `YOUR_TOSS_CLIENT_KEY`가 남아 있으면 결제창이 열리지 않습니다.
RC1을 켤 때는 클라 `rc1ServerOrder: true`와 서버 env를 **동시에** 맞추고, 레거시 pending 경로와 혼합 배포하지 마세요.

