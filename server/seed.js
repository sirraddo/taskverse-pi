/**
 * seed.js - Populate the TaskVerse Pi feed with starter tasks.
 *
 * Usage (run once from the server/ folder):
 *   SESSION_TOKEN=<your_admin_jwt> node seed.js
 *
 * Get SESSION_TOKEN: open Pi Browser -> authenticate -> open DevTools
 * Network tab -> any /api/ request -> copy the Authorization header value
 * (everything after "Bearer ").
 *
 * The script creates tasks via the API so they go through the normal
 * funding flow. Each task is created in 'awaiting_funding' status — you
 * must fund them via the Pi Browser payment flow to make them live.
 * Alternatively, for testing, set SKIP_FUNDING=true to mark them live
 * directly in MongoDB (requires MONGODB_URI in your .env).
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const API    = process.env.VITE_API_URL || 'https://taskverse-pi.onrender.com';
const TOKEN  = process.env.SESSION_TOKEN;

if (!TOKEN) {
  console.error('Set SESSION_TOKEN env var first. See header comment for how to get it.');
  process.exit(1);
}

const TASKS = [
  {
    title: 'Follow TaskVerse on Pi Browser',
    description: 'Open the Pi Browser app store, find TaskVerse Pi and tap Follow/Favorite. Screenshot your followed apps list as proof.',
    rewardPi: 0.2,
    slots: 50,
  },
  {
    title: 'Share TaskVerse link in a Pi community',
    description: 'Post the link https://taskverse-pi.vercel.app in any Pi Network Telegram group, forum, or chat. Screenshot showing your post with the link as proof.',
    rewardPi: 0.25,
    slots: 30,
  },
  {
    title: 'Write a short review of TaskVerse',
    description: 'Write at least 3 sentences about your experience using TaskVerse Pi and post it anywhere (Telegram, Twitter/X, forum). Share a screenshot or link as proof.',
    rewardPi: 0.3,
    slots: 20,
  },
  {
    title: 'Invite a friend to join TaskVerse',
    description: 'Send the TaskVerse Pi link to a friend and get them to sign up. Screenshot the conversation where you shared the link.',
    rewardPi: 0.35,
    slots: 25,
  },
  {
    title: 'Translate one TaskVerse UI string to your language',
    description: 'Find a UI text in the app that is not yet in your language. Post the original English text and your translation in the proof box.',
    rewardPi: 0.2,
    slots: 40,
  },
  {
    title: 'Report a bug or suggest a feature',
    description: 'Found something that does not work right, or have an idea to improve the app? Describe it clearly in the proof text. Best reports earn a bonus.',
    rewardPi: 0.15,
    slots: 100,
  },
  {
    title: 'Like or upvote TaskVerse on PiApps or similar directory',
    description: 'Find TaskVerse Pi on any Pi app directory or listing site and give it a like/upvote/rating. Screenshot as proof.',
    rewardPi: 0.1,
    slots: 100,
  },
  {
    title: 'Create a short video showing the TaskVerse app',
    description: 'Record a 30-60 second screen recording or video walking through TaskVerse Pi. Upload to YouTube, TikTok, or any platform and paste the link as proof.',
    rewardPi: 0.5,
    slots: 10,
  },
];

async function createTask(task) {
  const res = await fetch(API + '/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOKEN,
    },
    body: JSON.stringify(task),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

console.log('Creating', TASKS.length, 'seed tasks against', API);
console.log('Each task starts in awaiting_funding - fund via Pi Browser to make live.\n');

for (const task of TASKS) {
  try {
    const result = await createTask(task);
    console.log('Created:', task.title);
    console.log('  taskId:', result.taskId);
    console.log('  Fund amount:', result.amountToPay, 'Pi (reward pool + 5% fee)\n');
  } catch (err) {
    console.error('Failed to create:', task.title, '-', err.message);
  }
}

console.log('Done! Open the app in Pi Browser and fund each task to push it live.');
