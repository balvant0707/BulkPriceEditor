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

  const canDelete = canDeleteTask(task);

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

function normalizeStatus(status) {
  return String(status || "").toLowerCase().trim();
}

function normalizeStatusKey(status) {
  return normalizeStatus(status).replace(/[\s-]+/g, "_");
}

function getRollbackSummary(task) {
  return (
    task.rollback ||
    task.rollbackSummary ||
    task.executionSummary?.rollback ||
    task.executionSummary?.rollbackSummary ||
    {}
  );
}

function getRollbackStatusKey(task) {
  return normalizeStatusKey(
    task.rollbackStatus ||
      task.rollback?.status ||
      task.rollbackSummary?.status ||
      task.executionSummary?.rollbackStatus ||
      task.executionSummary?.rollback?.status ||
      task.executionSummary?.rollbackSummary?.status ||
      "",
  );
}

function isRollbackCompleted(task) {
  const taskStatus = normalizeStatusKey(task.status);
  const rollbackStatus = getRollbackStatusKey(task);
  const rollback = getRollbackSummary(task);

  return (
    rollbackStatus === "complete" ||
    rollbackStatus === "completed" ||
    rollbackStatus === "rolled_back" ||
    rollbackStatus === "rollback_complete" ||
    rollbackStatus === "rollback_completed" ||
    taskStatus === "rolled_back" ||
    taskStatus === "rollback_complete" ||
    taskStatus === "rollback_completed" ||
    ((taskStatus === "cancelled" || taskStatus === "canceled") &&
      rollback.ok === true) ||
    Boolean(rollback.completedAt) ||
    Boolean(rollback.rolledBackAt) ||
    (rollback.progress >= 100 && rollback.ok === true)
  );
}

function canDeleteTask(task) {
  const status = normalizeStatus(task.status);

  return (
    (status.includes("cancel") &&
      !status.includes("canceling") &&
      !status.includes("cancelling")) ||
    status.includes("failed") ||
    status.includes("error") ||
    isRollbackCompleted(task)
  );
}
