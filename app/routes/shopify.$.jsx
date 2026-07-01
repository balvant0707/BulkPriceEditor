import { redirect } from "@remix-run/node";

function redirectToAuth(request, params) {
  const url = new URL(request.url);
  const suffix = params["*"] ? `/${params["*"]}` : "";
  return redirect(`/auth${suffix}${url.search}`);
}

export const loader = async ({ request, params }) => redirectToAuth(request, params);

export const action = async ({ request, params }) => redirectToAuth(request, params);

