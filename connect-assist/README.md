# Template Connect Assist — 이미 개설된 템플릿 매장 실연동

신규 **입점 draft**(`/api/vendor-draft`, merchant-draft)와 분리된 장치입니다.

## 대상

- 업종 템플릿 인스턴스가 **이미** 떠 있음 (예: 짜장나라)
- 도시락.store / aibaeby.com에 **이미** 입점(또는 승인 대기) 업체가 있음
- 필요한 연동만 추가해 실연동(바인드)

## 흐름

1. 플랫폼 지정 + Intent `실연동` / `템플릿 연결`
2. 사업주 동의 (`privacy` / `terms` / `connect`)
3. 기존 `vendor_id` + `phone_last4` 증명
4. `POST .../api/template-bind` → `bind_token` + assist 프로필
5. 이 폴더의 설정으로 상태 조회·메뉴 스냅샷·포스 브릿지 힌트만 수행 (정산 금지)

## API (템플릿 쪽)

`POST /.netlify/functions/arkaon-participation?action=template-connect-execute`

```json
{
  "platformId": "dosirak.store",
  "dryRun": true,
  "vendor": { "vendor_id": "v_xxx", "phone_last4": "5678" },
  "consents": {
    "privacyAt": "2026-09-12T00:00:00.000Z",
    "termsAt": "2026-09-12T00:00:00.000Z",
    "connectAt": "2026-09-12T00:00:00.000Z"
  }
}
```

## Env

| 변수 | 용도 |
|------|------|
| `DOSIRAK_TEMPLATE_BIND_URL` | 예: `https://도시락.store/api/template-bind` |
| `AIBAEBY_TEMPLATE_BIND_URL` | 예: `https://aibaeby.com/api/template-bind` |
| `DOSIRAK_AFFILIATE_CONNECTOR_SECRET` / `AIBAEBY_AFFILIATE_CONNECTOR_SECRET` | 커넥터 키 |

## 설정

`config.example.json`을 복사해 로컬에서만 사용. **시크릿·bind_token 원문 금지.**
