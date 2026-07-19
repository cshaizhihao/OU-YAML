import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "./api";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";
import type { SessionUser } from "./shared/types";

export default function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => { api.me().then((value) => setUser(value.username ? { username: value.username, isAdmin: value.isAdmin } : null)).catch(() => setUser(null)); }, []);

  if (user === undefined) return <div className="app-loading" aria-label="正在加载"><LoaderCircle className="spin" size={24} /></div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Workspace user={user} onLogout={() => setUser(null)} />;
}
