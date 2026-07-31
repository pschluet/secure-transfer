import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { confirmSignIn, signIn } from "aws-amplify/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";

vi.mock("aws-amplify/auth");

const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ refresh: refreshSpy }),
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the email step first", () => {
    render(<Login />);
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });

  it("submits a trimmed, lowercased email via USER_AUTH/EMAIL_OTP and advances to the code step", async () => {
    const user = userEvent.setup();
    vi.mocked(signIn).mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" },
    } as never);

    render(<Login />);
    await user.type(screen.getByLabelText("Email address"), "  USER@EXAMPLE.COM  ");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({
        username: "user@example.com",
        options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" },
      })
    );
    expect(await screen.findByLabelText("Verification code")).toBeInTheDocument();
  });

  it("confirms the code and refreshes the session when the step is DONE", async () => {
    const user = userEvent.setup();
    vi.mocked(signIn).mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" },
    } as never);
    vi.mocked(confirmSignIn).mockResolvedValue({
      nextStep: { signInStep: "DONE" },
    } as never);

    render(<Login />);
    await user.type(screen.getByLabelText("Email address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Verification code"), "12345678");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: "12345678" })
    );
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled());
  });

  it("shows an error and stays on the code step when the code is wrong", async () => {
    const user = userEvent.setup();
    vi.mocked(signIn).mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" },
    } as never);
    vi.mocked(confirmSignIn).mockRejectedValue(new Error("Incorrect code"));

    render(<Login />);
    await user.type(screen.getByLabelText("Email address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("Verification code"), "00000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Incorrect code")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('resets to the email step via "Use a different email"', async () => {
    const user = userEvent.setup();
    vi.mocked(signIn).mockResolvedValue({
      nextStep: { signInStep: "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" },
    } as never);

    render(<Login />);
    await user.type(screen.getByLabelText("Email address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("Verification code");

    await user.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });
});
