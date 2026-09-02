import { Route } from '@/types/route';
import { AxiosRequestConfig } from 'axios';
import { FetchSignedWebSocketIdentityParameterError, PremiumFeatureError } from '@/types';
import { WebcastRoomChatPayload, WebcastRoomChatRouteResponse } from '@eulerstream/euler-api-sdk';

export type SendRoomChatFromEulerRouteParams = WebcastRoomChatPayload & { options?: AxiosRequestConfig };

export class SendRoomChatFromEulerRoute extends Route<SendRoomChatFromEulerRouteParams, WebcastRoomChatRouteResponse> {

    async call(
        {
            roomId,
            content,
            sessionId,
            ttTargetIdc,
            options
        }: SendRoomChatFromEulerRouteParams
    ): Promise<WebcastRoomChatRouteResponse> {

        const resolvedSessionId = sessionId || this.webClient.cookieJar.sessionId;
        const resolvedTtTargetIdc = ttTargetIdc || this.webClient.cookieJar.ttTargetIdc;

        if (resolvedSessionId && !resolvedTtTargetIdc) {
            throw new FetchSignedWebSocketIdentityParameterError(
                'ttTargetIdc must be set when sessionId is provided.'
            );
        }

        const fetchResponse = await this.webClient.webSigner.webcast.sendRoomChat({
                roomId,
                content,
                sessionId: resolvedSessionId,
                ttTargetIdc: resolvedTtTargetIdc
            },
            options
        );

        switch (fetchResponse.status) {
            case 401:
            case 403:
                throw new PremiumFeatureError(
                    'Sending chats requires an API key & a paid plan, as it uses cloud managed services.',
                    fetchResponse.data.message,
                    JSON.stringify(fetchResponse.data)
                );
            case 200:
                return fetchResponse.data;
            default:
                throw new Error(`Failed to send chat: ${fetchResponse?.data?.message || 'Unknown error'}`);
        }

    }

}
