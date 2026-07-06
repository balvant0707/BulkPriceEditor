import { redirect } from "@remix-run/node";

export const loader = async () => redirect("/contatti", 301);

export const action = async () => redirect("/contatti", 301);

