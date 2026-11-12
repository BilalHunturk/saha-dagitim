import { describe, expect, it } from "vitest";
import { LOGIN_MESSAGES, isTransientAuthError, parseLoginForm, signInErrorMessage } from "./login";

describe("parseLoginForm", () => {
  it("normalizes the phone into the synthetic auth email", () => {
    expect(parseLoginForm("0532 123 45 67", "secret")).toEqual({
      email: "905321234567@saha.local",
      password: "secret",
    });
  });

  it("rejects an invalid phone before any network call", () => {
    expect(parseLoginForm("0212 123 45 67", "secret")).toEqual({
      error: LOGIN_MESSAGES.INVALID_PHONE,
    });
  });

  it("treats an empty password as wrong credentials", () => {
    expect(parseLoginForm("05321234567", "")).toEqual({
      error: LOGIN_MESSAGES.WRONG_CREDENTIALS,
    });
  });
});

describe("signInErrorMessage", () => {
  it("maps invalid_credentials to the wrong-credentials message", () => {
    expect(
      signInErrorMessage({ name: "AuthApiError", status: 400, code: "invalid_credentials" }),
    ).toBe(LOGIN_MESSAGES.WRONG_CREDENTIALS);
  });

  it("maps a legacy 400 without a code to the wrong-credentials message", () => {
    expect(
      signInErrorMessage({ name: "AuthApiError", status: 400, message: "Invalid login credentials" }),
    ).toBe(LOGIN_MESSAGES.WRONG_CREDENTIALS);
  });

  it("maps HTTP 429 to the rate-limit message", () => {
    expect(signInErrorMessage({ name: "AuthApiError", status: 429 })).toBe(
      LOGIN_MESSAGES.RATE_LIMITED,
    );
  });

  it("maps the over_request_rate_limit code to the rate-limit message", () => {
    expect(signInErrorMessage({ status: 400, code: "over_request_rate_limit" })).toBe(
      LOGIN_MESSAGES.RATE_LIMITED,
    );
  });

  it("never reports a network failure as wrong credentials", () => {
    expect(signInErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      LOGIN_MESSAGES.CONNECTION,
    );
    expect(signInErrorMessage({ name: "AuthRetryableFetchError", status: 503 })).toBe(
      LOGIN_MESSAGES.CONNECTION,
    );
  });

  it("never reports another unexpected error as wrong credentials", () => {
    expect(signInErrorMessage({ name: "AuthApiError", status: 422, code: "validation_failed" })).toBe(
      LOGIN_MESSAGES.CONNECTION,
    );
    expect(signInErrorMessage({ name: "AuthUnknownError" })).toBe(LOGIN_MESSAGES.CONNECTION);
  });
});

describe("isTransientAuthError", () => {
  it("is true for retryable fetch errors, 429 and 5xx", () => {
    expect(isTransientAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isTransientAuthError({ name: "AuthApiError", status: 429 })).toBe(true);
    expect(isTransientAuthError({ name: "AuthApiError", status: 500 })).toBe(true);
    expect(isTransientAuthError({ name: "AuthUnknownError" })).toBe(true);
  });

  it("is false for definite answers (no session, rejected token)", () => {
    expect(isTransientAuthError(null)).toBe(false);
    expect(isTransientAuthError({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
    expect(isTransientAuthError({ name: "AuthApiError", status: 403, code: "bad_jwt" })).toBe(false);
    expect(isTransientAuthError({ name: "AuthApiError", status: 401 })).toBe(false);
  });
});
