-- ever_top10: 一度でもtop10にランクインしたフレームにセットされる
ALTER TABLE frames ADD COLUMN ever_top10 INTEGER NOT NULL DEFAULT 0;

-- user_deleted: ユーザーが削除操作をしたが ever_top10=1 のため保全されたフレーム
ALTER TABLE frames ADD COLUMN user_deleted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_frames_ever_top10 ON frames(ever_top10);
CREATE INDEX IF NOT EXISTS idx_frames_user_deleted ON frames(user_deleted);
