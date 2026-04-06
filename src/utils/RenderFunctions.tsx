export function SimpleSelect({ options, value, onChange }: { options: string[]; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  );
}