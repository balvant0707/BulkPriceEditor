import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  await login(request);
  return null; // This line should not be reached
};

export const action = async ({ request }) => {
  await login(request);
  return null; // This line should not be reached
};

export default function Auth() { return null; }
