import { handleWebhook } from "../_shared/webhook.ts";

Deno.serve((req) => handleWebhook(req));
