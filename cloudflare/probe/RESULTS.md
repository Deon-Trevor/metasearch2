# Provider probe, 2026-10-02

The Worker ran in a temporary Cloudflare remote development session. Each
query sent one request to each provider with the same Firefox user-agent header.
These are three observations from one session, not an availability guarantee.

| Query | Google | Bing | Brave |
| --- | --- | --- | --- |
| cloudflare workers | HTTP 429, blocked, 1,238 ms | 10 usable results, 268 ms | 18 usable results, 862 ms |
| Johannesburg weather | HTTP 429, blocked, 1,391 ms | 10 usable results, 277 ms | 20 usable results, 946 ms |
| open source metasearch | HTTP 429, blocked, 1,068 ms | 10 usable results, 269 ms | 20 usable results, 851 ms |

The probe counts a result only when Workers HTMLRewriter extracts both a title
and an external URL. It decoded Bing's result redirects before counting them.
Brave returned results under `.snippet[data-pos][data-type="web"]`; the
`#results` selector currently used by metasearch2 did not match that page.

The local Worker also reached Google, but Google sent a JavaScript-required
page without result markup. The remote Worker received HTTP 429. Google HTML
therefore cannot be assumed available for a Worker-native Search launch. Bing
and Brave worked in this sample, but their HTML layouts and access policies can
change. A production design needs explicit provider failure states and must
not treat a blocked or unparsable provider as an empty successful search.
