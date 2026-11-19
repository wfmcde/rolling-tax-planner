import React from 'react';

interface NumericFieldProps {
  label: string;
  fieldCode?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  helperText?: string;
}

export const NumericField: React.FC<NumericFieldProps> = ({
  label,
  fieldCode,
  value,
  onChange,
  disabled = false,
  prefix,
  suffix,
  step = 1000,
  min,
  max,
  helperText,
}) => {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-slate-700">{label}</label>
        {fieldCode && (
          <span className="text-[11px] font-mono text-slate-400 truncate max-w-[180px]" title={fieldCode}>
            {fieldCode}
          </span>
        )}
      </div>
      <div
        className={`flex items-center border rounded-md transition-colors ${
          disabled
            ? 'bg-slate-50 border-slate-200 text-slate-500'
            : 'bg-white border-slate-300 focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700/20'
        }`}
      >
        {prefix && (
          <span className="pl-2.5 pr-1 text-xs font-mono text-slate-400 select-none">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const parsed = e.target.value === '' ? 0 : Number(e.target.value);
            if (!Number.isNaN(parsed)) onChange(parsed);
          }}
          className={`w-full py-1.5 text-sm font-mono tabular-nums bg-transparent outline-none ${
            prefix ? 'pl-0.5' : 'pl-2.5'
          } ${suffix ? 'pr-1' : 'pr-2.5'} ${disabled ? 'cursor-not-allowed text-slate-500' : 'text-slate-900'}`}
        />
        {suffix && (
          <span className="pr-2.5 pl-1 text-xs font-mono text-slate-400 select-none">
            {suffix}
          </span>
        )}
      </div>
      {helperText && <p className="text-[11px] text-slate-500 leading-snug">{helperText}</p>}
    </div>
  );
};
