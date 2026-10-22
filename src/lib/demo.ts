/** Made-up figures on a developer's own machine (CI_DEMO=1), never in production: no UniFi, Payter or database needed. */
export const DEMO = process.env.CI_DEMO === "1" && process.env.NODE_ENV !== "production";
