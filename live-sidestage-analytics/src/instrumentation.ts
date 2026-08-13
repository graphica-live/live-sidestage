// リスナー(TikTok接続)の起動はworker.ts(`npm run worker`)側の責務。
// Webプロセスはリスナーを一切持たない — UI/API/socket.io overlayサーバーのみ。
export async function register() {}
