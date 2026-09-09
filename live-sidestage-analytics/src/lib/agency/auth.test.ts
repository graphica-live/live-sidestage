// DB不要のunitテスト。agencyAuthOptionsの静的設定だけを検証する。
import { describe, it, expect } from "vitest";
import { agencyAuthOptions } from "./auth";
import { AGENCY_GOOGLE_PROVIDER_ID } from "./session-cookie";

type GoogleUserOptions = {
  id?: string;
  authorization?: { params?: { prompt?: string } };
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
});
