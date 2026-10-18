import { handleApi } from "../_shared/api.ts";

Deno.serve((req) => handleApi(req));
