const SHOPIFY_CONTEXT_PARAMS = ["shop", "host", "embedded", "hmac", "locale", "timestamp"];

export function withShopifyEmbeddedParams(path, source, fallbackShop = "") {
  const url = new URL(path, "https://app.local");
  const sourceParams = getSearchParams(source);

  for (const param of SHOPIFY_CONTEXT_PARAMS) {
    const value = sourceParams.get(param);
    if (value && !url.searchParams.has(param)) {
      url.searchParams.set(param, value);
    }
  }

  if (fallbackShop && !url.searchParams.has("shop")) {
    url.searchParams.set("shop", fallbackShop);
  }

  return `${url.pathname}${url.search}`;
}

function getSearchParams(source) {
  if (!source) return new URLSearchParams();
  if (source instanceof URLSearchParams) return source;
  if (typeof Request !== "undefined" && source instanceof Request) {
    return new URL(source.url).searchParams;
  }
  if (typeof source === "string") {
    return new URL(source, "https://app.local").searchParams;
  }
  if (source.url) return new URL(source.url).searchParams;
  return new URLSearchParams();
}
