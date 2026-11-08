// Single source of truth for the Privacy Policy and Terms of Service.
// Rendered in-app (PrivacyPolicy.jsx / TermsOfService.jsx) AND turned into the
// static /privacy.html and /terms.html (scripts/build-legal.mjs, run before every
// build) so the in-app text, the public URLs given to Pi, and reality never drift.

export const LEGAL_UPDATED = 'November 2026';
export const OPERATOR = 'SIRRADDO GLOBAL LIMITED (RC 9939920), Ibadan, Oyo State, Nigeria';
export const CONTACT_EMAIL = 'sirraddogloballimited@gmail.com';

export const PRIVACY_SECTIONS = [
  { title: '1. Who we are', body: [
    `TaskVerse Earn is a micro-task marketplace that runs inside the Pi Browser. It is operated by ${OPERATOR}. We are the party responsible for the personal data described here.`,
  ] },
  { title: '2. What we collect', body: [
    'We collect only what is needed to run the marketplace:',
  ], list: [
    'Pi username and Pi UID, provided by the Pi Network SDK when you sign in. We never see your Pi password or your wallet keys.',
    'A verified/not-verified flag from the Pi SDK, used only to show a badge. We do not receive or store identity documents.',
    'Your country, only if you choose to set it, so you can see tasks meant for your region.',
    'A profile picture, only if you upload one.',
    'Task posts you create and the proof you submit for tasks: text, and optional screenshots, which are stored on our own servers.',
    'Payment and transaction records: Pi payment identifiers, amounts, status and reference IDs, needed to pay workers and settle disputes.',
    'Messages you send to support, disputes you open, referral links, and in-app notifications.',
    'Technical data: your IP address and a short-lived sign-in token. IP addresses are used for abuse and fraud prevention, rate limiting, and to work out an approximate country.',
  ] },
  { title: '3. How we use it', body: [], list: [
    'To sign you in through the Pi SDK and run your account.',
    'To review submissions, pay workers and refund or settle escrow through Pi payments.',
    'To detect fraud, such as recycled screenshots, duplicate submissions and fake accounts.',
    'To handle disputes and support requests, and to show your earnings history and receipts.',
    'To keep the service secure and meet legal obligations.',
  ] },
  { title: '4. Who we share it with', body: [
    'We do not sell your data and we do not run advertising or third-party analytics trackers. We share data only with:',
  ], list: [
    'Pi Network, because sign-in and payments are processed through the Pi SDK and Platform API.',
    'Our infrastructure providers, which host the app and database (web hosting, server hosting and database hosting). They process data on our behalf.',
    'A third-party geo-IP lookup service, which receives your IP address so we can derive an approximate country for fraud prevention.',
    'Authorities, where the law requires it.',
  ] },
  { title: '5. Keeping and deleting your data', body: [
    'We keep your data while your account is active, and afterwards for as long as needed to resolve disputes, prevent fraud, keep payment accounting records and meet legal duties.',
    `You can ask us to delete your account data at any time by emailing ${CONTACT_EMAIL} from the contact details you have used with us or by quoting your Pi username. We will act on a verified request within 30 days. Records we are legally or financially required to keep (for example payment records) may be retained in anonymised or restricted form.`,
  ] },
  { title: '6. Your rights', body: [
    'Under applicable data protection law, including the Nigeria Data Protection Act 2023, you may ask to access, correct or delete your personal data, to object to or restrict certain processing, and to complain to the Nigeria Data Protection Commission. Contact us using the details below to exercise these rights.',
  ] },
  { title: '7. Security', body: [
    'Data is transmitted over HTTPS. Access to admin tools is restricted and admin actions are logged. No system is perfectly secure, so we cannot guarantee absolute security.',
  ] },
  { title: '8. Age', body: [
    'TaskVerse Earn is for adults. You must be a registered Pi Network Pioneer, and we do not knowingly collect data from children.',
  ] },
  { title: '9. Cookies and local storage', body: [
    'We use only what is needed to keep you signed in and to remember display preferences such as dark mode. We do not use advertising cookies.',
  ] },
  { title: '10. Changes', body: [
    'If we change this policy we will update the date above and, for significant changes, tell you in the app.',
  ] },
  { title: '11. Contact', body: [
    `${OPERATOR}. Email: ${CONTACT_EMAIL}. You can also use the Support option inside the app.`,
  ] },
];

export const TERMS_SECTIONS = [
  { title: '1. Acceptance', body: [
    `By using TaskVerse Earn you agree to these Terms. The service is operated by ${OPERATOR}. If you do not agree, do not use the app.`,
  ] },
  { title: '2. What TaskVerse Earn does', body: [
    'TaskVerse Earn is a micro-task marketplace on the Pi Network. Task posters fund campaigns with Pi held in escrow. Workers complete tasks and earn Pi. The platform charges a service fee on funded campaigns (currently 5%), shown to the poster before they pay.',
  ] },
  { title: '3. Eligibility and account', body: [
    'You must be an adult registered Pi Network Pioneer. Access is only through the Pi Browser and only with Pi sign-in. You are responsible for activity on your account and may not operate more than one account to get around slot limits or limits on rewards.',
  ] },
  { title: '4. Worker rules', body: [
    'Submit honest, original proof of work. Recycled or unrelated screenshots, duplicate submissions and false claims are prohibited and may lead to rejection, withheld rewards or a ban.',
  ] },
  { title: '5. Task poster rules', body: [
    'Tasks must be truthful, achievable and lawful. Poster funds are held in escrow and released to workers only for valid, approved completions. Once a worker has been approved and paid, that payment cannot be reversed. We may remove a task that breaks these Terms or Pi Network rules; where a funded task is removed, the unspent escrow is handled by us on request through Support.',
  ] },
  { title: '6. Payments', body: [
    'All payments are made in Pi through the Pi Network SDK. TaskVerse Earn does not accept or pay any other currency. Pi payments depend on Pi Network availability and may be delayed. We do not guarantee any value, exchange rate or liquidity of Pi, and nothing in the app is financial advice or a promise of income.',
  ] },
  { title: '7. Reviews and disputes', body: [
    'Submissions are checked automatically and, where required, by an admin. If a submission is rejected you may open an appeal in the Dispute Board within 7 days. Admin decisions on disputes are final.',
  ] },
  { title: '8. Prohibited conduct', body: [
    'No spam, bots, fraud, hate speech, adult content, malware or links to harmful sites, and nothing that violates the Pi Network Terms. Tasks must not ask workers to share passwords, buy things, send money or give personal information.',
  ] },
  { title: '9. Suspension', body: [
    'We may suspend or remove accounts or content that break these Terms or put other users at risk.',
  ] },
  { title: '10. Liability', body: [
    'The service is provided as is. To the extent the law allows, we are not liable for losses from Pi Network downtime, wallet issues, failed transactions or third-party service interruptions. Nothing here limits liability that cannot be limited by law.',
  ] },
  { title: '11. Governing law', body: [
    'These Terms are governed by the laws of the Federal Republic of Nigeria.',
  ] },
  { title: '12. Changes and contact', body: [
    `We may update these Terms; continued use after an update means you accept it. Questions: ${CONTACT_EMAIL}.`,
  ] },
];
