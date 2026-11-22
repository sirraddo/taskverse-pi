import { Fragment } from 'react';

/** Tiny safe renderer for AI replies: **bold** and bullet-ish lines, no HTML injection. */
export default function MdLite({ text }) {
  const lines = String(text || '').split('\n');
  return lines.map((ln, i) => {
    const parts = ln.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={j}>{p.slice(2, -2)}</b> : <Fragment key={j}>{p.replace(/^#{1,3}\s+/, '')}</Fragment>));
    return <Fragment key={i}>{parts}{i < lines.length - 1 ? '\n' : ''}</Fragment>;
  });
}
