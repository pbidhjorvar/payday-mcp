# Bank Integration Test

This folder contains a simple connectivity/auth test script for Landsbankinn B2B.

## Prerequisites
- `.env` updated with:
  - `LBIN_BASE_URL` (defaults to `https://b2b.fbl.is/lib2b.dll?processXML`)
  - `LBIN_COMPANY_ID`
  - `LBIN_USERNAME`
  - `LBIN_PASSWORD`
  - Optional mTLS: `LBIN_CERT_PATH`, `LBIN_KEY_PATH`, `LBIN_KEY_PASSPHRASE`
  - Optional: `LBIN_TIMEOUT_MS`

## Run
- Generated login XML (connectivity test):
```
npx tsx Bank/test-lbin-connection.ts
```
  - This builds a best-effort `LI_Innskra` XML from env vars and POSTS it.
  - If element names differ from bank XSD, you’ll see a validation error — that still proves TLS and POST reach the service.

- Use your own XML file (exact XSD):
```
LBIN_XML_FILE=Bank/samples/login.example.xml npx tsx Bank/test-lbin-connection.ts
```

## Output
- JSON with `status`, `duration_ms`, response `headers`, and a `body_preview` (first ~2KB).
- On error, prints a JSON error diagnostic including any response body preview.

## Notes
- No cookies/session are persisted here; this is a single-shot POST for smoke testing.
- For production client, implement full login/session and subsequent statement queries.

