import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" rel="home">Reels</s-link>
        <s-link href="/app/help">How to show reels</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Short-lived login replies (e.g. 401) can leave a blank page; reload once to get a fresh Shopify login.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && !error.data) {
    return <Recover status={error.status} />;
  }
  return boundary.error(error);
}

const RELOAD_KEY = "reelstage-auto-reload";

function Recover({ status }: { status: number }) {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    } catch {
      /* storage unavailable */
    }
    if (Date.now() - last > 20000) {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        /* storage unavailable */
      }
      window.location.reload();
    } else {
      setGaveUp(true);
    }
  }, []);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      {gaveUp ? (
        <>
          <p>The app couldn't reconnect to Shopify (status {status}).</p>
          <p>It may be waking up. Wait a minute, then reload.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </>
      ) : (
        <p>Reconnecting to Shopify…</p>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
