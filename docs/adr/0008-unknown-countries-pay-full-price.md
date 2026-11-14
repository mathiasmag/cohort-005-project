# A buyer whose country is unknown pays full price

Purchasing-power prices depend on the buyer's country, which we only trust from the `CF-IPCountry` header (or the dev override). When it is missing, `resolveCountry` returns null and the buyer pays full price: a page never waits on a network call to learn the country. This overcharges some learners who would have qualified for a discount, and we accept that.

## Considered Options

- **Look up `X-Forwarded-For` on ip-api.com.** Rejected: every course and lesson page would wait on a plain-HTTP call limited to 45 requests a minute.
- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.
