import { redirect } from "@remix-run/node";

export const loader = async () => redirect("/app/tasks/new");

export const action = async () => redirect("/app/tasks/new");
