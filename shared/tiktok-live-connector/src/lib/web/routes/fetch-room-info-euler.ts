import { Route } from '@/types/route';
import { WebcastRoomInfoRouteResponse } from '@eulerstream/euler-api-sdk';
import { AxiosRequestConfig } from 'axios';

export type FetchRoomInfoFromEulerRouteParams = { uniqueId: string, options?: AxiosRequestConfig };

export class FetchRoomInfoFromEulerRoute extends Route<FetchRoomInfoFromEulerRouteParams, WebcastRoomInfoRouteResponse> {

    async call({ uniqueId, options }): Promise<WebcastRoomInfoRouteResponse> {
        const fetchResponse = await this.webClient.webSigner.webcast.retrieveRoomInfo(uniqueId, options);
        return fetchResponse.data;
    }

}
