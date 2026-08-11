export default function TrustSection() {
  const items = [
    { title: "Free Shipping", text: "On orders over 2000 BDT" },
    { title: "100% Authentic", text: "Carefully selected products" },
    { title: "Exclusive Offers", text: "Deals and discounts every week" },
    { title: "Support", text: "Quick help when you need it" },
  ];

  return (
    <section className="container-ph pb-12">
      <div className="grid grid-cols-1 gap-4 rounded-[28px] border border-[#ead9d1] bg-[#f8f3ef] p-6 md:grid-cols-4">
        {items.map((item) => (
          <div key={item.title} className="text-center">
            <h3 className="text-lg font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm text-neutral-600">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}