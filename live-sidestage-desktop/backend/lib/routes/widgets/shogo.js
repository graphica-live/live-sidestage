'use strict';

module.exports = function registerShogoRoutes({
    app, io,
    setWidgetShogoSettings,
    buildShogoPayload,
    registerShogoUser,
    deleteShogoUser,
    addShogoTitleEntry,
    updateShogoTitleEntry,
    deleteShogoTitleEntry,
    reorderShogoTitleEntries,
    emitShogoTest,
    emitShogoUserTest,
}) {
    app.get('/api/widgets/shogo/config', (req, res) => {
        res.json(buildShogoPayload());
    });

    app.patch('/api/widgets/shogo', (req, res) => {
        const settings = setWidgetShogoSettings(req.body || {});
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, settings, ...payload });
    });

    // ユーザーIDだけを先に登録する（称号は後から一覧の「+ 称号追加」で追加する）。
    app.patch('/api/widgets/shogo/users', (req, res) => {
        const user = registerShogoUser(req.body || {});

        if (!user) {
            return res.status(400).json({ error: 'ユーザーIDを入力してください。' });
        }

        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, user, ...payload });
    });

    // 登録済みユーザーを称号ごと削除する。
    app.delete('/api/widgets/shogo/users', (req, res) => {
        deleteShogoUser({ uniqueId: req.query?.uniqueId });
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, ...payload });
    });

    // 新規称号を1件追加する（同じユーザーに複数登録可）。
    app.patch('/api/widgets/shogo/titles', (req, res) => {
        const entry = addShogoTitleEntry(req.body || {});

        if (!entry) {
            return res.status(400).json({ error: 'ユーザーIDと称号を入力してください。' });
        }

        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, entry, ...payload });
    });

    // 既存の称号のバッジ・サイズだけを更新する。
    app.patch('/api/widgets/shogo/titles/entry', (req, res) => {
        const entry = updateShogoTitleEntry(req.body || {});

        if (!entry) {
            return res.status(404).json({ error: '指定された称号が見つかりません。' });
        }

        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, entry, ...payload });
    });

    app.patch('/api/widgets/shogo/titles/reorder', (req, res) => {
        reorderShogoTitleEntries(req.body || {});
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, ...payload });
    });

    app.delete('/api/widgets/shogo/titles', (req, res) => {
        deleteShogoTitleEntry({ uniqueId: req.query?.uniqueId, entryId: req.query?.entryId });
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/shogo/test', (req, res) => {
        emitShogoTest();
        res.json({ ok: true });
    });

    // ユーザー個別のテスト再生: そのユーザーが実際にハートミーを投げた時と同じ内容（登録済みの
    // 全称号を登録順のまま）で表示する。
    app.post('/api/widgets/shogo/users/:uniqueId/test', (req, res) => {
        const didFire = emitShogoUserTest(req.params.uniqueId);

        if (!didFire) {
            return res.status(404).json({ error: '登録された称号が見つかりません。' });
        }

        res.json({ ok: true });
    });
};
