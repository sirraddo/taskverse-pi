// Generates public/privacy.html and public/terms.html from src/legalContent.js
import { writeFileSync } from 'node:fs';
import { PRIVACY_SECTIONS, TERMS_SECTIONS, LEGAL_UPDATED } from '../src/legalContent.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(title, sections, other) {
  const body = sections.map((s) =>
    `<h2>${esc(s.title)}</h2>\n` +
    (s.body || []).map((p) => `<p>${esc(p)}</p>`).join('\n') +
    (s.list ? `\n<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : '')
  ).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — TaskVerse Earn</title>
<style>
  body{font-family:sans-serif;max-width:700px;margin:0 auto;padding:24px 20px;color:#2d3748;line-height:1.7}
  h1{color:#059669;font-size:1.6rem;margin-bottom:4px}
  h2{font-size:1rem;margin-top:26px;color:#374151}
  a{color:#059669} footer{margin-top:40px;font-size:.8rem;color:#718096;border-top:1px solid #e2e8f0;padding-top:16px}
</style>
</head>
<body>
<h1>${title}</h1>
<p>TaskVerse Earn &middot; Last updated: ${LEGAL_UPDATED}</p>
${body}
<footer>TaskVerse Earn &mdash; built for the Pi Network &bull; <a href="/${other[0]}">${other[1]}</a></footer>
</body>
</html>
`;
}

writeFileSync(new URL('../public/privacy.html', import.meta.url), page('Privacy Policy', PRIVACY_SECTIONS, ['terms.html', 'Terms of Service']));
writeFileSync(new URL('../public/terms.html', import.meta.url), page('Terms of Service', TERMS_SECTIONS, ['privacy.html', 'Privacy Policy']));
console.log('legal pages generated');
