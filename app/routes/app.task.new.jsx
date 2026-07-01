import { redirect } from "@remix-run/node";

export const action = async () => redirect("/app/tasks/new");

