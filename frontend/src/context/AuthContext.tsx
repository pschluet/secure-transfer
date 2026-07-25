import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

type AuthStatus = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: AuthStatus;
  isAdmin: boolean;
  email: string | null;
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    isAdmin: false,
    email: null,
  });

  async function refresh(): Promise<void> {
    try {
      await getCurrentUser();
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (!idToken) throw new Error("No ID token in session");
      const groups = (idToken.payload["cognito:groups"] as string[] | undefined) ?? [];
      setState({
        status: "signedIn",
        isAdmin: groups.includes("Admins"),
        email: (idToken.payload.email as string | undefined) ?? null,
      });
    } catch {
      setState({ status: "signedOut", isAdmin: false, email: null });
    }
  }

  useEffect(() => {
    void refresh();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "signedOut") {
        void refresh();
      }
    });
    return unsubscribe;
  }, []);

  async function signOut(): Promise<void> {
    await amplifySignOut();
    await refresh();
  }

  return (
    <AuthContext.Provider value={{ ...state, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
