const fs = require('fs');
let content = fs.readFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', 'utf8');

// The glass <svg> opening tag was already removed; content starts with orphaned <defs>
// Find the comment line and the pig img tag, remove everything in between
const commentLine = '        <!-- Front jar layer: rim, highlights and outer shell stay in front of gifts -->\n';
const pigImg = '        <img class="jar-photo jar-photo-pig" src="/widgets/pig.png" alt="piggy bank">';
const commentEnd = content.indexOf(commentLine) + commentLine.length;
const pigIdx = content.indexOf(pigImg);
content = content.slice(0, commentEnd) + content.slice(pigIdx);

// Now remove bee comment + bee SVG block
// Find the jar img tag end, then the closing </div> after bee
const jarImgLine = '        <img class="jar-photo jar-photo-jar" src="/widgets/jar.png" alt="glass jar">';
const beeComment = '\n\n        <!-- ===== Theme: bee';
const divClose = '\n    </div>';
const jarImgEnd = content.indexOf(jarImgLine) + jarImgLine.length;
const beeIdx = content.indexOf(beeComment, jarImgEnd);
const divIdx = content.indexOf(divClose, beeIdx);
content = content.slice(0, beeIdx) + content.slice(divIdx);

fs.writeFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', content, 'utf8');
console.log('done commentEnd=' + commentEnd + ' pigIdx=' + pigIdx + ' beeIdx=' + beeIdx + ' divIdx=' + divIdx);
