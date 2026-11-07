# Local image moderation

Photos are checked on the backend before storage in Journal posts, Glimpses,
connection messages, and profile pictures. Existing uploads are not rescanned.

Uses NSFWJS 4.3.0 (MIT), its bundled MobileNetV2 model, TensorFlow.js CPU,
and sharp. No API key, remote inference, or per-image service charge. Hosting
CPU/memory costs still apply. Model inference runs in a bounded worker queue.
No photo or raw content is added to moderation logs.

Policy: Porn + Hentai probability >= 0.90 is a violation; 0.60–0.90 is refused
without a strike; lower scores are allowed. Sexy alone is not a strike.
These are initial thresholds, not calibrated safety guarantees. Review against
representative, consented evaluation images before production use. This model
does not establish age/consent and does not moderate violence, hate symbols,
or text embedded in images. Do not treat it as comprehensive moderation.

High-confidence rejections share the text moderation fixed-hour counter.
Scanner failure refuses the upload with no added strike. Only validated inline
JPEG/PNG/WebP images are accepted; remote image URLs are not fetched.

Sources: https://github.com/infinitered/nsfwjs
