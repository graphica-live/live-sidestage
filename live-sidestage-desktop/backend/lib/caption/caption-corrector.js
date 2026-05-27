'use strict';

class CaptionCorrector {
    constructor() {
        this._rules = []; // [{ from, to, useRegex, flags }] sorted longest-first
    }

    setRules(rules) {
        this._rules = [...rules].sort((a, b) => b.from.length - a.from.length);
    }

    apply(text) {
        let result = text;
        for (const rule of this._rules) {
            if (!rule.from) continue;
            try {
                if (rule.useRegex) {
                    result = result.replace(new RegExp(rule.from, rule.flags || 'g'), rule.to);
                } else {
                    const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    result = result.replace(new RegExp(escaped, 'g'), rule.to);
                }
            } catch (e) { console.warn('[caption-corrector] invalid regex skipped:', rule.from, e.message); }
        }
        return result;
    }
}

module.exports = { CaptionCorrector };
