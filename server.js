const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

function serveSidepanelWithShim(req, res) {
  const htmlPath = path.join(__dirname, 'sidepanel.html');
  fs.readFile(htmlPath, 'utf8', (err, html) => {
    if (err) {
      res.status(500).send('Error loading sidepanel.html');
      return;
    }
    const injected = html.replace(
      '<script src="sidepanel.js"></script>',
      '<script src="chrome-mock.js"></script>\n  <script src="sidepanel.js"></script>'
    );
    res.type('html').send(injected);
  });
}

app.get('/', serveSidepanelWithShim);
app.get('/sidepanel.html', serveSidepanelWithShim);

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
