export default function Loading() {
  return (
    <main className="min-h-screen bg-[#fffaf7]">
      <div className="container-ph py-10">
        <div className="mb-8 h-8 w-48 animate-pulse rounded-full bg-[#ead9d1]" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[28px] border border-[#ead9d1] bg-white p-4"
            >
              <div className="aspect-square animate-pulse rounded-[22px] bg-[#f3e7e1]" />
              <div className="mt-4 h-4 w-20 animate-pulse rounded-full bg-[#ead9d1]" />
              <div className="mt-4 h-5 w-3/4 animate-pulse rounded-full bg-[#ead9d1]" />
              <div className="mt-4 h-7 w-24 animate-pulse rounded-full bg-[#ead9d1]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}