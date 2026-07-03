import { redirect } from "@remix-run/node";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const taskId = Number(params.id);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Response("Task not found", { status: 404 });
  }

  const task = await db.task.findFirst({
    where: {
      id: taskId,
      shop: session.shop,
    },
  });

  if (!task) {
    throw new Response("Task not found", { status: 404 });
  }

  const canDelete = ["Canceled", "Rolled back", "Rollback failed"].includes(
    task.status,
  );

  if (!canDelete) {
    return redirect(
      `/app/tasks?message=${encodeURIComponent(
        "Task can be deleted only after rollback is complete.",
      )}`,
    );
  }

  await db.task.delete({
    where: { id: task.id },
  });

  return redirect(
    `/app/tasks?message=${encodeURIComponent("Task was deleted.")}`,
  );
};

export const loader = async () => redirect("/app/tasks");
