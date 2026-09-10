// DB不要のunitテスト。agencyAuthOptionsの静的設定だけを検証する。
import { describe, it, expect, vi } from "vitest";
import { agencyAuthOptions } from "./auth";
import { AGENCY_APPLE_PROVIDER_ID, AGENCY_GOOGLE_PROVIDER_ID } from "./session-cookie";

type GoogleUserOptions = {
  id?: string;
  authorization?: { params?: { prompt?: string } };
};

type AppleUserOptions = {
  id?: string;
  checks?: string[];
};

describe("agencyAuthOptions.providers", () => {
  it("agency-google GoogleProviderはprompt=select_accountを要求する(複数アカウント時のGoogle側InteractiveLogin 500回避)", () => {
    // next-authのGoogleProvider()はデフォルト(id:"google"、authorizationはscopeのみ)をトップレベルに置き、
    // 呼び出し側が渡したoptions(id/clientId/authorization等)は`options`プロパティにそのまま保持する。
    // 実際の認可URL生成時にnext-auth内部(core/lib/providers.js parseProviders)がこの両者をマージする。
    // したがってトップレベルの`id`は"google"のままで、"agency-google"もトップレベルの`authorization`も
    // 呼び出し側の設定を反映しない。検証は`options`側で行う(src/lib/auth.integration.test.ts と同じ理由)。
    const google = agencyAuthOptions.providers.find(
      (p) => (p as { options?: GoogleUserOptions }).options?.id === AGENCY_GOOGLE_PROVIDER_ID,
    );
    expect(google).toBeDefined();
    const userOptions = (google as { options?: GoogleUserOptions } | undefined)?.options;
    expect(userOptions?.authorization?.params?.prompt).toBe("select_account");
  });

  it("Apple設定が完了している場合(env var APPLE_SERVICES_ID 設定済み)、apple-agency AppleProviderを含む", () => {
    // web側と同じく、Apple env var 未設定ならプロバイダ自体が providers 配列に含まれない。
    // ここでは webAppleConfig() が null を返すと想定される環境（CI等）では、
    // このテストは skip される。env var 設定済みなら、provider id が "apple-agency" であることを確認。
    const apple = agencyAuthOptions.providers.find(
      (p) => (p as { options?: AppleUserOptions }).options?.id === AGENCY_APPLE_PROVIDER_ID,
    );

    if (!apple) {
      // Apple設定未完了の環境。テスト skip。
      return;
    }

    expect(apple).toBeDefined();
    const userOptions = (apple as { options?: AppleUserOptions } | undefined)?.options;
    expect(userOptions?.id).toBe(AGENCY_APPLE_PROVIDER_ID);
    // checks は配信者側と同じく pkce/state/nonce を含む。
    expect(userOptions?.checks).toContain("pkce");
    expect(userOptions?.checks).toContain("state");
    expect(userOptions?.checks).toContain("nonce");
  });
});
