import { createCookieSessionStorage } from "@remix-run/node";

const flashSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__bulk_price_editor_flash",
    httpOnly: true,
    maxAge: 60,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SHOPIFY_API_SECRET || "bulk-price-editor-flash"],
    secure: process.env.NODE_ENV === "production",
  },
});

export async function getFlashSession(request) {
  return flashSessionStorage.getSession(request.headers.get("Cookie"));
}

export async function commitFlashSession(session) {
  return flashSessionStorage.commitSession(session);
}
