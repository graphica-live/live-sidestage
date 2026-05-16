// Reconstructs gift-jar.html from the corrupted state.
// The file has correct content in two places:
//   Lines 1-4: correct DOCTYPE/html/head/meta charset
//   Lines 2218-2327: original head continuation (viewport, style, body start)
//   Lines 120+: </div> then <script>...</script></body></html>
// Plus lines 2328+ have more corrupted content to ignore.
const fs = require('fs');
const content = fs.readFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', 'utf8');
const lines = content.split('\n');

// Lines are 1-indexed in editor, 0-indexed in array
const correctTop = lines.slice(0, 4).join('\n');                     // lines 1-4
const headContinuation = lines.slice(2217, 2320).join('\n');         // lines 2218-2320
const bodyStart = lines.slice(2320, 2327).join('\n');                // lines 2321-2327
const pigJarImgs = [
    '        <img class="jar-photo jar-photo-pig" src="/widgets/pig.png" alt="piggy bank">',
    '        <img class="jar-photo jar-photo-jar" src="/widgets/jar.png" alt="glass jar">'
].join('\n');
const closeDiv = lines[119];                                          // line 120: </div>
// Script section: find <script> tag (line 122 = index 121) through </html>
const scriptSection = lines.slice(121, 2213).join('\n');             // lines 122-2213

const result = [
    correctTop,
    headContinuation,
    bodyStart,
    pigJarImgs,
    closeDiv,
    '',
    scriptSection,
    ''
].join('\n');

fs.writeFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', result, 'utf8');
console.log('Rebuilt. Total lines: ' + result.split('\n').length);
