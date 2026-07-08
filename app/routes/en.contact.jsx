import { redirect } from "@remix-run/node";

export const loader = async () => {
  return redirect("/contatti", 301);
};

export const action = async () => {
  return redirect("/contatti", 301);
};