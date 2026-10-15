import { createTenancy } from "@tenancy-node/core";
import { config } from "../config.js";
import { tenancyConfig } from "./config.js";
import { PersistentErrorTracker } from "./error-store.js";

/** Errores guardados en la base central (panel /admin → Errores). Lo enciende server.ts. */
export const errorTracker = new PersistentErrorTracker(config.tenancy.databaseUrl);

export const tenancy = createTenancy({ ...tenancyConfig, errorTracker });
