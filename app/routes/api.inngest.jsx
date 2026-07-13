import { serve } from "inngest/remix";
import { inngest } from "../inngest/client";
import { autoReapply } from "../inngest/functions/autoReapply";
import { salesScheduler } from "../inngest/functions/salesScheduler";

const handler = serve({
  client: inngest,
  functions: [autoReapply, salesScheduler],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

export { handler as action, handler as loader };
