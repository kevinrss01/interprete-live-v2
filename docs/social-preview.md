# Social sharing preview

The landing and browser app include Open Graph and large-image Twitter Card tags
in their initial HTML. Both use the same public image:

- Public URL: `https://tryinterprete.com/social-preview-v1.jpg`
- Source: `apps/landing/public/social-preview-v1.jpg`
- Format: JPEG, 1733 × 907 px, compressed for fast crawler downloads.
- Branding: the official logo, warm sunrise clouds, charcoal sans-serif headline,
  orange italic serif headline, and `tryinterprete.com`.

The landing and app retain separate canonical URLs. SPA routes receive the app's
HTML metadata through the existing Vercel rewrite. `www` and the former public
Vercel hostnames follow their existing redirects. API JSON responses and binary
downloads are not web pages and do not receive social metadata.

When replacing the image, use a new versioned filename and update both HTML
entry points, including the image dimensions and alt text. Previously shared
messages may retain the sharing platform's cached preview; a deployment cannot
force those caches to refresh.

The image was created with the built-in image generation tool, using the
official transparent logo and existing landing cloud art as input. The final
generation prompt is recorded in [social-preview-prompt.txt](social-preview-prompt.txt).

Protocol reference: [Open Graph](https://ogp.me/).

## Verification — 2026-10-25

- Typecheck, server lint, the existing test suite, server bundle and both static
  web builds passed. The existing desktop chunk-size and landing dependency
  directive warnings remain.
- Inspected the generated image and its JPEG delivery version. Verified text,
  logo, image dimensions, public asset copying and metadata in both source and
  built HTML. Independent review found no blocking metadata or branding defect;
  its delivery-size and alt-text suggestions were applied.
- Existing landing `noindex` is intentionally preserved. This task does not
  change search-engine indexing, authentication, speech or native packaging.
- No real microphone, playback or provider benchmark was used.
