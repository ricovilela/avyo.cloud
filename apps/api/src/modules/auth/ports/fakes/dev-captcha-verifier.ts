import { Injectable } from "@nestjs/common";

import type { CaptchaVerifier } from "../captcha-verifier";

/**
 * Development / test CaptchaVerifier that always passes.
 *
 * Intended as the default binding until a concrete captcha provider
 * (hCaptcha / reCAPTCHA / Turnstile) is chosen, and as a stand-in in tests
 * where captcha validation is not the subject under test.
 */
@Injectable()
export class DevCaptchaVerifier implements CaptchaVerifier {
  verify(_captcha0: string, _captcha1: string, _clientIp?: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}
