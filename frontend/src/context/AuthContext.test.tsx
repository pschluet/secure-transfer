import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from "aws-amplify/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("aws-amplify/auth");
vi.mock("aws-amplify/utils", () => ({
  Hub: { listen: vi.fn(() => vi.fn()) },
}));

function session(groups: string[], email = "user@example.com", sub = "sub-123") {
  return {
    tokens: {
      idToken: {
        toString: () => "id-token",
        payload: { "cognito:groups": groups, email, sub },
      },
    },
  };
}

function Probe() {
  const { status, isAdmin, email, sub, signOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="isAdmin">{String(isAdmin)}</span>
      <span data-testid="email">{email ?? "none"}</span>
      <span data-testid="sub">{sub ?? "none"}</span>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves to signedOut when getCurrentUser rejects", async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(new Error("no user"));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("false");
    expect(screen.getByTestId("email")).toHaveTextContent("none");
  });

  it("resolves to signedOut when fetchAuthSession has no id token", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({} as never);
    vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: {} } as never);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
  });

  it('marks isAdmin true only when cognito:groups includes "Admins"', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({} as never);
    vi.mocked(fetchAuthSession).mockResolvedValue(session(["Admins"]) as never);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("true");
    expect(screen.getByTestId("email")).toHaveTextContent("user@example.com");
    expect(screen.getByTestId("sub")).toHaveTextContent("sub-123");
  });

  it("marks isAdmin false when the user is not in the Admins group", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({} as never);
    vi.mocked(fetchAuthSession).mockResolvedValue(session(["Users"]) as never);

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    expect(screen.getByTestId("isAdmin")).toHaveTextContent("false");
  });

  it("signOut calls Amplify signOut then re-resolves the state", async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentUser).mockResolvedValue({} as never);
    vi.mocked(fetchAuthSession).mockResolvedValue(session(["Admins"]) as never);
    vi.mocked(amplifySignOut).mockResolvedValue(undefined as never);

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));

    vi.mocked(getCurrentUser).mockRejectedValue(new Error("signed out"));
    await user.click(screen.getByRole("button", { name: "sign out" }));

    await waitFor(() => expect(amplifySignOut).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
  });
});
