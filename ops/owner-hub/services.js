// What the status page watches. "group" is what the public sees; "summary" is the owner-only numbers endpoint.
module.exports = [
  { id: 'zappi-ng-api', group: 'Zappi NG', name: 'Zappi NG server', url: 'https://zappi-api.sirraddo.com.ng/health', expect: (j) => j && j.ok && j.db !== 'disconnected', summary: 'https://zappi-api.sirraddo.com.ng/api/owner/summary' },
  { id: 'zappi-ng-app', group: 'Zappi NG', name: 'Zappi NG app', url: 'https://zappi-ng-frontend.vercel.app/' },
  { id: 'taskverse-api', group: 'TaskVerse', name: 'TaskVerse server', url: 'https://taskverse-api.sirraddo.com.ng/health', expect: (j) => j && j.ok, summary: 'https://taskverse-api.sirraddo.com.ng/api/owner/summary' },
  { id: 'taskverse-app', group: 'TaskVerse', name: 'TaskVerse app', url: 'https://taskverse-pi.vercel.app/' },
  { id: 'zappipay-api', group: 'ZAPPI PAY', name: 'ZAPPI PAY server', url: 'https://api.zappipay.com.ng/api/health', expect: (j) => j && j.ok, summary: 'https://api.zappipay.com.ng/api/owner/summary' },
  { id: 'zappipay-web', group: 'ZAPPI PAY', name: 'ZAPPI PAY website', url: 'https://zappipay.com.ng/' },
  { id: 'sirraddo-web', group: 'SIRRADDO website', name: 'sirraddo.com.ng', url: 'https://www.sirraddo.com.ng/' },
];
