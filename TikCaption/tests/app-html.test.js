/**
 * Static validation of app.html structure.
 * Catches bugs like HTML elements placed inside <script> blocks,
 * which cause JS parse errors and break all button event handlers.
 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf-8');

// Split into regions: before first <script>, inside script, after </script>
const scriptOpenPos = html.indexOf('<script>');
const scriptClosePos = html.lastIndexOf('</script>');
const beforeScript = html.substring(0, scriptOpenPos);
const scriptContent = html.substring(scriptOpenPos + 8, scriptClosePos);

describe('app.html – DOM elements outside script', () => {
  // Elements that JS code references via getElementById must exist BEFORE
  // the inline <script> block so they're in the DOM when the script runs.
  const requiredBeforeScript = [
    'tts-user-suggest',
    'tts-filter-btn',
    'tts-mapping-btn',
    'tts-conv-btn',
    'tts-emoji-btn',
    'tts-emote-btn',
    'tts-filter-count',
    'tts-mapping-count',
    'tts-conv-count',
    'tts-emoji-count',
    'tts-emote-count',
  ];

  for (const id of requiredBeforeScript) {
    test(`#${id} exists before <script>`, () => {
      expect(beforeScript).toContain(`id="${id}"`);
    });
  }
});

describe('app.html – known DOM elements not inside script block', () => {
  // These IDs must NOT appear inside the script block.
  // If they do, getElementById returns null at script-run time → TypeError → all handlers die.
  const idsNotInScript = [
    'tts-user-suggest',
    'tts-filter-btn',
    'tts-mapping-btn',
    'tts-filter-modal',
  ];

  for (const id of idsNotInScript) {
    test(`#${id} declaration not inside <script> block`, () => {
      // A real element declaration looks like id="foo", not data-table="foo" or a string
      expect(scriptContent).not.toMatch(new RegExp(`<[a-z]+ [^>]*id="${id}"`));
    });
  }
});

describe('app.html – TTS modal map is complete', () => {
  const modalPairs = [
    ['tts-filter-btn', 'tts-filter-modal'],
    ['tts-mapping-btn', 'tts-mapping-modal'],
    ['tts-conv-btn', 'tts-conv-modal'],
    ['tts-emoji-btn', 'tts-emoji-modal'],
    ['tts-emote-btn', 'tts-emote-modal'],
  ];

  for (const [btnId, modalId] of modalPairs) {
    test(`button #${btnId} and modal #${modalId} both exist`, () => {
      expect(html).toContain(`id="${btnId}"`);
      expect(html).toContain(`id="${modalId}"`);
    });
  }
});
