import { useAuth } from "./context/AuthContext";
import { Login } from "./pages/Login";
import { AdminDashboard } from "./pages/AdminDashboard";
import { RecipientDashboard } from "./pages/RecipientDashboard";

export function App() {
  const { status, isAdmin, email, signOut } = useAuth();

  if (status === "loading") {
    return <div className="center-screen">Loading…</div>;
  }

  if (status === "signedOut") {
    return <Login />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="wordmark">
          <span className="wordmark-dot" />
          <h1>Secure Transfer</h1>
        </div>
        <div className="app-header-right">
          <span className="hint mono">{email}</span>
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>{isAdmin ? <AdminDashboard /> : <RecipientDashboard />}</main>
    </div>
  );
}
