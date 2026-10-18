import { handleWake } from "../_shared/wake.ts";

Deno.serve((req) => handleWake(req));
