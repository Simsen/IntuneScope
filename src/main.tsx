import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// TEMPORARY: Editor write spike (/?spike). The flag survives the sign-in redirect so the Explorer app never sees the Editor auth code.
const SPIKE_FLAG = "intunescope-spike";
if (new URLSearchParams(window.location.search).has("spike")) sessionStorage.setItem(SPIKE_FLAG, "1");
const spike = sessionStorage.getItem(SPIKE_FLAG) === "1";
const Spike = lazy(() => import("./spike/Spike"));

// Clickjacking guard: GitHub Pages cannot send frame-ancestors / X-Frame-Options headers.
if (window.top !== window.self) {
  document.body.innerHTML = "<p style='font:16px system-ui;padding:16px'>This app cannot run inside a frame.</p>";
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {spike ? (
        <Suspense fallback={null}>
          <Spike />
        </Suspense>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}
