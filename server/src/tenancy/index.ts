import { createTenancy } from "@tenancy-node/core";
import { tenancyConfig } from "./config.js";

export const tenancy = createTenancy(tenancyConfig);
