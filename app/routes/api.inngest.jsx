import { serve } from "inngest/remix";
import { inngest } from "../inngest/client";
import { autoReapply } from "../inngest/functions/autoReapply";
import { salesScheduler } from "../inngest/functions/salesScheduler";

const handler = serve({
  client: inngest,
  functions: [autoReapply, salesScheduler],
});

function isUnsignedExecutionProbe(request) {
  const url = new URL(request.url);
  const hasExecutionParams =
    url.searchParams.has("fnId") || url.searchParams.has("stepId");
  const hasSignature = request.headers.has("x-inngest-signature");

  return hasExecutionParams && !hasSignature;
}

function unsignedExecutionProbeResponse() {
  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "This Inngest execution endpoint requires x-inngest-signature. Use the base /api/inngest URL for sync, or let Inngest invoke this URL.",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "x-inngest-sdk-handled": "true",
      },
    },
  );
}

export async function loader(args) {
  if (isUnsignedExecutionProbe(args.request)) {
    return unsignedExecutionProbeResponse();
  }

  return handler(args);
}

export async function action(args) {
  if (isUnsignedExecutionProbe(args.request)) {
    return unsignedExecutionProbeResponse();
  }

  return handler(args);
}
