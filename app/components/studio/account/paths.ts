// Account & Billing lives on two admin surfaces with one set of screens:
// the standalone /studio and the embedded /app (Shopify admin). The screens
// take their links from here, so neither surface sends a merchant to the other.

export interface AccountPaths {
  account: string;
  plan: string;
}

export const STUDIO_ACCOUNT_PATHS: AccountPaths = { account: "/studio/account", plan: "/studio/account/plan" };
export const APP_ACCOUNT_PATHS: AccountPaths = { account: "/app/account", plan: "/app/account/plan" };
