const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0";

const PROVIDERS = [
  {
    name: "google",
    origin: "https://www.google.com",
    path: "/search",
    params: { nfpr: "1", filter: "0", start: "0" },
    result: '[jscontroller="SC7lYd"]',
    link: '[jscontroller="SC7lYd"] a[href]',
    title: '[jscontroller="SC7lYd"] h3',
  },
  {
    name: "bing",
    origin: "https://www.bing.com",
    path: "/search",
    params: {},
    result: "#b_results > li.b_algo",
    link: "#b_results > li.b_algo h2 a[href]",
    title: "#b_results > li.b_algo h2 a",
  },
  {
    name: "brave",
    origin: "https://search.brave.com",
    path: "/search",
    params: {},
    result: '.snippet[data-pos][data-type="web"]',
    link: '.snippet[data-pos][data-type="web"] a[href]',
    title: '.snippet[data-pos][data-type="web"] .search-snippet-title',
  },
];

function resultUrl(href, provider) {
  if (!href) return null;
  try {
    let url = new URL(href.replace(/&amp;/g, "&"), provider.origin);
    if (provider.name === "bing" && url.hostname === "www.bing.com" && url.pathname === "/ck/a") {
      const encoded = url.searchParams.get("u");
      if (encoded?.startsWith("a1")) url = new URL(atob(encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/")));
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname === new URL(provider.origin).hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function inspectPage(html, provider) {
  let pageTitle = "";
  const links = [];
  const rewriter = new HTMLRewriter()
    .on("title", { text(text) { pageTitle += text.text; } })
    .on("a[href]", {
      element(element) {
        this.link = null;
        const url = resultUrl(element.getAttribute("href"), provider);
        if (!url || links.length >= 3) return;
        const link = { url, text: "" };
        element.onEndTag(() => {
          link.text = link.text.trim().slice(0, 120);
          if (link.text) links.push(link);
          if (this.link === link) this.link = null;
        });
        this.link = link;
      },
      text(text) {
        if (this.link) this.link.text += text.text;
      },
    });
  await rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html" } })).text();
  return { pageTitle: pageTitle.trim().slice(0, 120), externalLinkSamples: links };
}

async function parseResults(html, provider) {
  const active = [];
  const results = [];
  let candidates = 0;
  let linkMatches = 0;
  let titleChunks = 0;
  const rewriter = new HTMLRewriter()
    .on(provider.result, {
      element(element) {
        candidates++;
        const result = { title: "", url: null };
        active.push(result);
        element.onEndTag(() => {
          active.splice(active.indexOf(result), 1);
          result.title = result.title.trim();
          if (result.title && result.url) results.push(result);
        });
      },
    })
    .on(provider.link, {
      element(element) {
        linkMatches++;
        const result = active.at(-1);
        if (result && !result.url) result.url = resultUrl(element.getAttribute("href"), provider);
      },
    })
    .on(provider.title, {
      text(text) {
        titleChunks++;
        const result = active.at(-1);
        if (result) result.title += text.text;
      },
    });
  await rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html" } })).text();
  return { candidates, linkMatches, titleChunks, results };
}

async function probe(provider, query) {
  const url = new URL(provider.path, provider.origin);
  url.search = new URLSearchParams({ q: query, ...provider.params });
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": FIREFOX_UA,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const headersMs = Math.round(performance.now() - started);
    const html = await response.text();
    const blocked = [403, 429].includes(response.status)
      || /\/sorry\/|\/captcha\//i.test(new URL(response.url).pathname)
      || /unusual traffic|verify you are human|automated requests|id=["']challenge-running["']/i.test(html);
    const jsRequired = /\/httpservice\/retry\/enablejs/i.test(html);
    const parsed = !blocked && response.ok ? await parseResults(html, provider) : { candidates: 0, linkMatches: 0, titleChunks: 0, results: [] };
    const page = await inspectPage(html, provider);
    const classification = blocked ? "blocked" : !response.ok ? "http_error" : jsRequired ? "js_required" : parsed.results.length ? "usable" : "no_usable_results";
    return {
      provider: provider.name,
      classification,
      status: response.status,
      finalHost: new URL(response.url).hostname,
      contentType: response.headers.get("content-type"),
      headersMs,
      totalMs: Math.round(performance.now() - started),
      bodyChars: html.length,
      ...page,
      candidates: parsed.candidates,
      linkMatches: parsed.linkMatches,
      titleChunks: parsed.titleChunks,
      usableResults: parsed.results.length,
      samples: parsed.results.slice(0, 2),
    };
  } catch (error) {
    return {
      provider: provider.name,
      classification: error.name === "TimeoutError" ? "timeout" : "request_error",
      totalMs: Math.round(performance.now() - started),
      error: String(error.message || error),
    };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/probe") {
      return new Response("GET /probe?q=your+search+term\n", { status: 404 });
    }
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 100) {
      return new Response("q must be between 1 and 100 characters\n", { status: 400 });
    }
    const providers = await Promise.all(PROVIDERS.map((provider) => probe(provider, query)));
    return Response.json({ query, time: new Date().toISOString(), providers }, {
      headers: { "Cache-Control": "no-store" },
    });
  },
};
