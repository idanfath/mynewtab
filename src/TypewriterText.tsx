import { useEffect, useRef, useState, type ReactNode } from 'react';

export const TYPEWRITER_DURATION = 1300;
export const TYPEWRITER_PAUSE = 55;

function renderTypedText(text: string, codeToken?: string) {
  if (!codeToken) return text;

  const tokenStart = text.indexOf(codeToken.slice(0, 4));
  if (tokenStart < 0) return text;

  const tokenEnd = Math.min(tokenStart + codeToken.length, text.length);
  return (
    <>
      {text.slice(0, tokenStart)}
      <code>{text.slice(tokenStart, tokenEnd)}</code>
      {text.slice(tokenEnd)}
    </>
  );
}

export default function TypewriterText({
  text,
  reserve,
  codeToken,
}: {
  text: string;
  reserve: string;
  codeToken?: string;
}): ReactNode {
  const [displayed, setDisplayed] = useState(text);
  const displayedRef = useRef(text);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedRef.current = text;
      setDisplayed(text);
      return;
    }

    let timeoutId: number;
    const current = displayedRef.current;
    if (current === text) return;

    const stepCount = text.startsWith(current)
      ? text.length - current.length
      : current.length + text.length;
    const stepDelay = (TYPEWRITER_DURATION - TYPEWRITER_PAUSE)
      / Math.max(1, stepCount);
    const step = () => {
      const currentText = displayedRef.current;
      if (currentText === text) return;

      const typing = text.startsWith(currentText);
      const next = typing
        ? text.slice(0, currentText.length + 1)
        : currentText.slice(0, -1);
      displayedRef.current = next;
      setDisplayed(next);

      if (next !== text) {
        timeoutId = window.setTimeout(step, stepDelay);
      }
    };

    timeoutId = window.setTimeout(step, TYPEWRITER_PAUSE + stepDelay);
    return () => window.clearTimeout(timeoutId);
  }, [text]);

  return (
    <span className="app-typewriter" aria-label={text}>
      <span className="app-typewriter-reserve" aria-hidden="true">
        {renderTypedText(reserve, codeToken)}
      </span>
      <span className="app-typewriter-value" aria-hidden="true">
        {renderTypedText(displayed, codeToken)}
      </span>
    </span>
  );
}
