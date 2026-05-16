const fs = require('fs');
const content = fs.readFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', 'utf8');
const lines = content.split('\n');

// Keep lines 1-1104 (indices 0-1103), which contain everything through </script>
// Then append </body></html>
const trimmed = lines.slice(0, 1104).join('\n') + '\n</body>\n</html>\n';

fs.writeFileSync('c:/dev/tiktok-app/backend/public/widgets/gift-jar.html', trimmed, 'utf8');
console.log('Trimmed to', trimmed.split('\n').length, 'lines');
