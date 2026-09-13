import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n";
import { loadSettings } from "./useSettings";

// Before the first render: a component that reads a key while i18next is still
// loading would render the key itself.
initI18n(loadSettings().language);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
