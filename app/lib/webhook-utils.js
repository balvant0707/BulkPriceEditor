export function normalizeWebhookTopic(topic) {
  const value = String(topic || "").toLowerCase();

  if (value.includes("app") && value.includes("scopes")) {
    return "app/scopes_update";
  }

  if (value.includes("app") && value.includes("uninstalled")) {
    return "app/uninstalled";
  }

  if (value.includes("orders") && value.includes("create")) {
    return "orders/create";
  }

  if (value.includes("customers") && value.includes("data")) {
    return "customers/data_request";
  }

  if (value.includes("customers") && value.includes("redact")) {
    return "customers/redact";
  }

  if (value.includes("shop") && value.includes("redact")) {
    return "shop/redact";
  }

  return value.replace(/_/g, "/");
}

export function normalizeScopePayload(value) {
  if (!value) return "";

  if (Array.isArray(value)) {
    return value
      .map((scope) => {
        if (typeof scope === "string") return scope;
        return scope?.handle || scope?.name || "";
      })
      .map((scope) => scope.trim())
      .filter(Boolean)
      .join(",");
  }

  if (typeof value === "object") {
    return normalizeScopePayload(Object.values(value));
  }

  return String(value)
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .join(",");
}
