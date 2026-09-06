export interface CaptchaVerifier {
  // Resolves true when both challenge fields pass provider validation.
  verify(captcha0: string, captcha1: string, clientIp?: string): Promise<boolean>;
}

export const CAPTCHA_VERIFIER = Symbol("CAPTCHA_VERIFIER");
