import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./styles/v14.css";
import "./styles/v15.css";
import "./styles/v17.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
