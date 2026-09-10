// DB不要のunitテスト。事務所用provider idがagencyHandlerへ正しく振り分けられることを固定する。
import { describe, it, expect } from "vitest";
import { handlerFor } from "./route";
import { AGENCY_APPLE_PROVIDER_ID, AGENCY_GOOGLE_PROVIDER_ID } from "@/lib/agency/session-cookie";

describe("handlerFor", () => {
  it("agency-google はagencyHandlerへ振り分けられる", () => {
    const agencyResult = handlerFor({ params: { nextauth: ["callback", AGENCY_GOOGLE_PROVIDER_ID] } });
    const streamerResult = handlerFor({ params: { nextauth: ["callback", "google"] } });
    // 同じhandlerFor呼び出しの結果同士を比較することで、実装がstreamerHandler/agencyHandlerの
    // どちらを返したかをNextAuthハンドラの内部実装に依存せず判定する。
    expect(agencyResult).not.toBe(streamerResult);
  });

  it("apple-agency はagencyHandlerへ振り分けられる(agency-googleと同じhandlerになる)", () => {
    const agencyGoogleResult = handlerFor({ params: { nextauth: ["callback", AGENCY_GOOGLE_PROVIDER_ID] } });
    const agencyAppleResult = handlerFor({ params: { nextauth: ["callback", AGENCY_APPLE_PROVIDER_ID] } });
    expect(agencyAppleResult).toBe(agencyGoogleResult);
  });

  it("配信者側の apple (事務所用idと異なる)はstreamerHandlerへ振り分けられる", () => {
    const streamerAppleResult = handlerFor({ params: { nextauth: ["callback", "apple"] } });
    const streamerGoogleResult = handlerFor({ params: { nextauth: ["callback", "google"] } });
    expect(streamerAppleResult).toBe(streamerGoogleResult);
  });

  it("providerIdが無い場合(session等)はstreamerHandlerへ振り分けられる", () => {
    const noProviderResult = handlerFor({ params: { nextauth: ["session"] } });
    const streamerGoogleResult = handlerFor({ params: { nextauth: ["callback", "google"] } });
    expect(noProviderResult).toBe(streamerGoogleResult);
  });
});
