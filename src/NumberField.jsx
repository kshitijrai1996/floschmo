import { useState } from 'react';

const show = (v) => (Number.isFinite(v) ? String(v) : '');

// A numeric text box that never fights the user while they type.
//
// A plain controlled <input type="number"> re-renders from the parsed number
// on every keystroke, which mangles half-typed values such as "0.", "-" or
// "1e". Here the raw text is kept while the field has focus, and every
// keystroke that already reads as a number is committed immediately.
//
//   value     number | undefined   (undefined = empty → "auto")
//   onChange  (number | undefined) => void
export default function NumberField({ value, onChange, placeholder, invalid, title, className = '', ...rest }) {
  const [draft, setDraft] = useState(null); // text while editing; null when not focused

  const handleChange = (e) => {
    const text = e.target.value;
    setDraft(text);
    const trimmed = text.trim();
    if (trimmed === '') { onChange(undefined); return; }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onChange(n); // otherwise wait for more typing
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      className={`${className} ${invalid ? 'num-invalid' : ''}`.trim()}
      placeholder={placeholder}
      title={title}
      aria-invalid={invalid || undefined}
      value={draft ?? show(value)}
      onFocus={(e) => { setDraft(show(value)); e.target.select(); }}
      onChange={handleChange}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }}
      {...rest}
    />
  );
}
