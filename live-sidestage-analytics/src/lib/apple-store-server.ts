import type {
  JWSTransactionDecodedPayload,
  JWSRenewalInfoDecodedPayload,
  ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";

// module-levelでクライアントを作らない(APPLE_APP_STORE_PRIVATE_KEY未設定のローカル開発で
// importしただけでthrowするのを防ぐ。stripe.tsと同じパターン)。
let productionClient: AppStoreServerAPIClient | undefined;
let sandboxClient: AppStoreServerAPIClient | undefined;
let productionVerifier: SignedDataVerifier | undefined;
let sandboxVerifier: SignedDataVerifier | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function buildClient(environment: Environment): AppStoreServerAPIClient {
  const privateKey = requiredEnv("APPLE_APP_STORE_PRIVATE_KEY");
  const keyId = requiredEnv("APPLE_APP_STORE_KEY_ID");
  const issuerId = requiredEnv("APPLE_APP_STORE_ISSUER_ID");
  const bundleId = requiredEnv("APPLE_BUNDLE_ID");
  return new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment);
}

function getProductionClient(): AppStoreServerAPIClient {
  if (!productionClient) productionClient = buildClient(Environment.PRODUCTION);
  return productionClient;
}

function getSandboxClient(): AppStoreServerAPIClient {
  if (!sandboxClient) sandboxClient = buildClient(Environment.SANDBOX);
  return sandboxClient;
}

// Appleの公式推奨パターン: 固定環境を信じず、まずProductionへ照会し、
// 「これはSandboxのtransactionだ」というエラーを検知したらSandboxへフォールバックする。
// 固定Production運用だと審査員のSandbox購入検証が通らずリジェクトされるため。
export async function getAllSubscriptionStatuses(transactionId: string) {
  try {
    return await getProductionClient().getAllSubscriptionStatuses(transactionId);
  } catch (error) {
    if (isSandboxTransactionError(error)) {
      return await getSandboxClient().getAllSubscriptionStatuses(transactionId);
    }
    throw error;
  }
}

function isSandboxTransactionError(error: unknown): boolean {
  // app-store-server-libraryはAPIエラーをAPIExceptionとして投げ、Sandbox取引を
  // Production環境へ問い合わせた場合は4040010(TransactionIdNotFoundError)相当を返す。
  return (
    typeof error === "object" &&
    error !== null &&
    "httpStatusCode" in error &&
    (error as { httpStatusCode?: number }).httpStatusCode === 404
  );
}

function rootCAs(): Buffer[] {
  return requiredEnv("APPLE_ROOT_CA_BASE64_LIST")
    .split(",")
    .map((b64) => Buffer.from(b64, "base64"));
}

function buildVerifier(environment: Environment): SignedDataVerifier {
  const bundleId = requiredEnv("APPLE_BUNDLE_ID");
  const appAppleId = process.env.APPLE_APP_APPLE_ID
    ? Number(process.env.APPLE_APP_APPLE_ID)
    : undefined;
  // Appleが配布するG3 Root CA証明書。SignedDataVerifierはJWSの署名チェーンをこれと照合する。
  return new SignedDataVerifier(rootCAs(), true, environment, bundleId, appAppleId);
}

function getProductionVerifier(): SignedDataVerifier {
  if (!productionVerifier) productionVerifier = buildVerifier(Environment.PRODUCTION);
  return productionVerifier;
}

function getSandboxVerifier(): SignedDataVerifier {
  if (!sandboxVerifier) sandboxVerifier = buildVerifier(Environment.SANDBOX);
  return sandboxVerifier;
}

function isInvalidEnvironmentError(error: unknown): boolean {
  return error instanceof VerificationException && error.status === VerificationStatus.INVALID_ENVIRONMENT;
}

// SignedDataVerifierはコンストラクタで固定した環境とJWS内のenvironmentクレームが
// 一致しないとINVALID_ENVIRONMENTで検証自体を拒否する(JWS内のクレームを見て動的に
// 判別してくれるわけではない)。Productionのverifierで固定運用すると、審査員の
// Sandbox購入・Sandbox notificationsを検証できず必ず失敗するため、getAllSubscriptionStatuses
// と同じくProduction→Sandboxフォールバックする(実装後レビュー指摘、Codex/Fable一致)。
async function verifyWithFallback<T>(verify: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  try {
    return await verify(getProductionVerifier());
  } catch (error) {
    if (isInvalidEnvironmentError(error)) {
      return await verify(getSandboxVerifier());
    }
    throw error;
  }
}

export async function verifyAndDecodeTransaction(
  signedTransactionInfo: string,
): Promise<JWSTransactionDecodedPayload> {
  return verifyWithFallback((v) => v.verifyAndDecodeTransaction(signedTransactionInfo));
}

export async function verifyAndDecodeRenewalInfo(
  signedRenewalInfo: string,
): Promise<JWSRenewalInfoDecodedPayload> {
  return verifyWithFallback((v) => v.verifyAndDecodeRenewalInfo(signedRenewalInfo));
}

export async function verifyAndDecodeNotification(
  signedPayload: string,
): Promise<ResponseBodyV2DecodedPayload> {
  return verifyWithFallback((v) => v.verifyAndDecodeNotification(signedPayload));
}
