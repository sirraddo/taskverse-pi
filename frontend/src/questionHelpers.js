// Shared helpers for in-app task types (quiz / survey / written).
export const TASK_TYPES = [
  { kind: 'standard', icon: '✅', label: 'Do & prove', help: 'Workers do something and send proof (text or screenshot).' },
  { kind: 'quiz', icon: '🧠', label: 'Quiz', help: 'Multiple-choice questions with right answers. All right = paid automatically.' },
  { kind: 'survey', icon: '📊', label: 'Survey', help: 'Multiple-choice questions, any answer counts. You see the totals.' },
  { kind: 'written', icon: '✍️', label: 'Written answer', help: 'Translations, reviews, feedback or labelling. Workers write their answer in the app.' },
];

export const emptyQuestion = () => ({ q: '', options: ['', ''], answer: 0 });

// Quick check before posting, so mistakes show at once instead of after the payment step starts.
export function questionsProblem(kind, questions) {
  if (kind !== 'quiz' && kind !== 'survey') return null;
  if (!questions.length) return 'Add at least one question.';
  for (const [i, q] of questions.entries()) {
    if (q.q.trim().length < 3) return `Question ${i + 1} needs some words.`;
    if (q.options.filter((o) => o.trim()).length < 2) return `Question ${i + 1} needs at least 2 choices.`;
  }
  return null;
}

// Drops empty choices (keeping the right answer pointing at the same choice).
export function cleanQuestions(kind, questions) {
  return questions.map((q) => {
    const keep = q.options.map((o, j) => ({ o: o.trim(), j })).filter((x) => x.o);
    const out = { q: q.q.trim(), options: keep.map((x) => x.o) };
    if (kind === 'quiz') out.answer = Math.max(0, keep.findIndex((x) => x.j === q.answer));
    return out;
  });
}
