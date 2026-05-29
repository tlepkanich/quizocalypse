import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Sidebar, SidebarLayout } from "../components/sidebar";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, _count: { select: { quizzes: true } } },
  });

  const captures = shop
    ? await prisma.emailCapture.count({
        where: { quiz: { shopId: shop.id } },
      })
    : 0;

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    counts: {
      quizzes: shop?._count.quizzes ?? 0,
      captures,
    },
  });
};

export default function App() {
  const { apiKey, counts } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <SidebarLayout>
        <Sidebar counts={counts} />
        <div
          className="qz-main"
          style={{ flex: 1, minWidth: 0, overflow: "auto" }}
        >
          <Outlet />
        </div>
      </SidebarLayout>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
