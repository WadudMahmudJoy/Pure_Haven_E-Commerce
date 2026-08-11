type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
};

export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: SectionHeaderProps) {
  return (
    <div className="mb-8 text-center">
      {eyebrow ? (
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-[#7a5244]">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-semibold md:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-neutral-600">{subtitle}</p> : null}
    </div>
  );
}