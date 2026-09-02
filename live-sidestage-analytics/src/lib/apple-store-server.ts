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

// verify-purchase route側で「実在しないtransactionId」を400(クライアント起因)と
// 区別するために公開する(実装後レビュー指摘、LOW — 未検出のままだと素通りで500になり、
// 壊れた/悪意あるクライアントが5xxを量産できる)。
export function isTransactionNotFoundError(error: unknown): boolean {
  return isSandboxTransactionError(error);
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

// Production検証で公式ライブラリ(@apple/app-store-server-library)が必須とする値。
// 未設定のまま任意扱いにすると、購入だけ成立してverify/webhookの署名検証が全滅しうる
// (Design Modeレビュー指摘、HIGH)。App Store ConnectのApp情報ページに表示される
// 数値のApple ID。
function requiredAppAppleId(): number {
  const raw = requiredEnv("APPLE_APP_APPLE_ID");
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`APPLE_APP_APPLE_ID must be a positive integer, got: ${raw}`);
  }
  return value;
}

function buildVerifier(environment: Environment): SignedDataVerifier {
  const bundleId = requiredEnv("APPLE_BUNDLE_ID");
  const appAppleId = requiredAppAppleId();
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

// verify-purchase/webhookで初めて環境変数不足に気づくと、購入だけ成立して以後の検証・
// webhookが全滅する(Design Modeレビュー指摘、HIGH)。init APIの時点で必須環境変数の有無を
// 確認し、揃っていなければ購入導線自体を開始させない(apple/init route参照)。
const REQUIRED_APPLE_ENV_VARS = [
  "APPLE_APP_STORE_PRIVATE_KEY",
  "APPLE_APP_STORE_KEY_ID",
  "APPLE_APP_STORE_ISSUER_ID",
  "APPLE_BUNDLE_ID",
  "APPLE_ROOT_CA_BASE64_LIST",
  "APPLE_APP_APPLE_ID",
  "APPLE_PRODUCT_ID_PRO",
  "APPLE_PRODUCT_ID_ULTRA",
] as const;

export function isAppleBillingConfigured(): boolean {
  return REQUIRED_APPLE_ENV_VARS.every((name) => !!process.env[name]);
}
