# Search provider probe

This temporary Worker checks whether the three main metasearch2 HTML engines
return usable results from Cloudflare egress. It does not serve Search or deploy
to its domain. It sends a fixed set of provider requests for each query and
reports response status, timing, block signals, and results extracted with
Workers HTMLRewriter. It stores nothing.

```sh
npm ci
npm run dev:remote
curl 'http://127.0.0.1:8798/probe?q=cloudflare%20workers'
```

Remote development runs the Worker on Cloudflare's network. `npm run dev` runs
the same code locally and cannot establish Cloudflare egress behavior. Stop the
remote session when finished. The probe is not a production search endpoint.

`usable` means the current metasearch2 selector found a title and an external
result URL. `no_usable_results` can mean a layout change, an unrecognized block,
or a genuine empty page; inspect that case before drawing a conclusion. Timing
and block behavior may vary by query, region, and time.
