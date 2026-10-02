// No-ops; the static coverage checker (coverage-map.ts) reads the call sites.
export const covers = (routeKey: string): void => void routeKey;
export const coversPage = (pagePath: string): void => void pagePath;
