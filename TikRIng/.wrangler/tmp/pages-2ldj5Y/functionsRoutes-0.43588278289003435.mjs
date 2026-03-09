import { onRequestGet as __api_frames__id__ts_onRequestGet } from "C:\\Users\\joegr\\.gemini\\antigravity\\profileimagefitservice\\functions\\api\\frames\\[id].ts"
import { onRequestPost as __api_upload_ts_onRequestPost } from "C:\\Users\\joegr\\.gemini\\antigravity\\profileimagefitservice\\functions\\api\\upload.ts"

export const routes = [
    {
      routePath: "/api/frames/:id",
      mountPath: "/api/frames",
      method: "GET",
      middlewares: [],
      modules: [__api_frames__id__ts_onRequestGet],
    },
  {
      routePath: "/api/upload",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_upload_ts_onRequestPost],
    },
  ]