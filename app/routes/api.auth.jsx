import { redirect } from "@remix-run/node";

function redirectToAuth(request) {
  const url = new URL(request.url);
  return redirect(`/auth${url.search}`);
}

export const loader = async ({ request }) => redirectToAuth(request);

export const action = async ({ request }) => redirectToAuth(request);

