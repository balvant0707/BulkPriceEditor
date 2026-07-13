import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "bulk-price-editor",
  name: "Bulk Price Editor",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
