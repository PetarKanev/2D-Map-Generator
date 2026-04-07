export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export function SimpleSelect({ options, value, onChange }: { options: SelectOption[]; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  );
}