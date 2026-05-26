import type { ReactNode } from 'react'

export function SettingsSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="border-b border-hairline px-6 py-6">
      <h2 className="text-[15px] font-semibold text-primary">{title}</h2>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  )
}

export function FieldRow({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] md:items-center">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-secondary">{label}</span>
        {detail ? (
          <span className="mt-1 block text-[12px] leading-5 text-muted">{detail}</span>
        ) : null}
      </span>
      {children}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-8 w-full rounded-card border border-hairline bg-card px-2.5 text-[13px] text-primary outline-none placeholder:text-muted focus:border-hairline-strong"
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-8 w-full rounded-card border border-hairline bg-card px-2.5 text-[13px] text-primary outline-none focus:border-hairline-strong"
    />
  )
}

export function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-8 w-full rounded-card border border-hairline bg-card px-2.5 text-[13px] text-primary outline-none focus:border-hairline-strong"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 justify-self-start accent-accent-primary md:justify-self-end"
    />
  )
}

export function RangeInput({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-hairline accent-accent-primary"
      />
      <span className="min-w-[3ch] text-right text-[12px] tabular-nums text-muted">
        {value}{unit}
      </span>
    </div>
  )
}
