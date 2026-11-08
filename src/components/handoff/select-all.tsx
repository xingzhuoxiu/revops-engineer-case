'use client';

/** Ticks or unticks every invoice checkbox in the list. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select all invoices to send"
      onChange={(e) => {
        for (const box of document.querySelectorAll<HTMLInputElement>('input[name="pick"]')) {
          box.checked = e.currentTarget.checked;
        }
      }}
    />
  );
}
