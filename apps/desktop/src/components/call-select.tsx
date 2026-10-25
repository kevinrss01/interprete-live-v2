import { Label } from "@interprete/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@interprete/ui/components/select";

export function CallSelect({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value)?.label;
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={options}
        value={value || null}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string" && next) onChange(next);
        }}
      >
        <SelectTrigger id={id} title={selected}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="call-select-menu" align="start" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="pl-3">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
