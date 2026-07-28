# Form upload privacy

Files collected by a form's **File Upload** (`field_file`) block are lead
PII — trade-in titles, insurance cards, pay stubs, credit-app supporting
documents. They are handled differently from the rest of our object
storage, which is deliberately public (logos, avatars, ad renders, media
library).

## How it works

| Step | Behavior |
| --- | --- |
| Upload | `uploadToS3(key, body, type, { visibility: 'private' })` — explicit `private` ACL, `Cache-Control: private, no-store` |
| Key | `form-uploads/{accountKey}/{formId}/{uuid}-{sanitized-filename}` |
| Stored in `FormSubmission.data` | `{ url, key, name, size, type }` — the binary never touches the database |
| Read | Only through `GET /api/forms/files` |

`/api/forms/files` authorizes two ways, because two very different
audiences need these files:

1. **Signed token** (`?key=…&exp=…&sig=…`) — an HMAC over the object key
   *and* the expiry, so neither can be edited independently. This is the
   link that goes into lead notification emails and ADF `<comments>`
   forwarded to the dealer's CRM. Nobody in VinSolutions/Tekion has a Loomi
   login, so those links must stand alone. TTL is
   `FILE_TOKEN_TTL_DAYS` (90 days).
2. **Loomi session** (`?key=…`, no token) — used by the submissions
   drawer. Scoped to the owning account, parsed out of the key. Staff
   access therefore never expires, even after the emailed token has.

On success the route 302s to a 5-minute presigned URL rather than
streaming bytes, so the transfer comes straight from object storage.

The signing key is derived from `NEXTAUTH_SECRET` via a domain-separation
label, so there is **no new secret to provision** — but note the
consequence below.

## Operational notes

- **Rotating `NEXTAUTH_SECRET` invalidates every outstanding file link.**
  Already-sent emails and CRM leads will get a 403. Staff can still open
  the files from the submissions drawer (session auth), so nothing is
  lost — but expect dealer complaints if the secret is rotated.
- **Keep the bucket non-public.** If the storage backend has ACLs disabled
  (`AccessControlListNotSupported`), `uploadToS3` retries without an ACL
  and visibility falls back to bucket policy. A bucket-wide public policy
  would then expose these keys. Verify with:

  ```bash
  curl -sI "https://<bucket>.<region>.digitaloceanspaces.com/form-uploads/<accountKey>/<formId>/<file>"
  ```

  A correctly configured bucket returns `403`, not `200`.
- **Submissions captured before this change** stored a public bucket URL
  and no `key`. Those rows still render — the drawer falls back to `url` —
  but the underlying objects remain public-read. Re-ACL them if that
  matters:

  ```bash
  s3cmd setacl --acl-private --recursive s3://<bucket>/form-uploads/
  ```

- Size limits are enforced in three places and must stay consistent:
  `MAX_FILE_SIZE_BYTES` (25MB per file) and `MAX_TOTAL_UPLOAD_BYTES`
  (25MB per submission) in `src/lib/forms/file-upload.ts`, and
  `client_max_body_size 30m` set by the deploy workflows. The proxy value
  must stay above the app total, or oversized bodies are rejected by nginx
  with an HTML 413 the app never sees.
