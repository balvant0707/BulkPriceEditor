export const PRICING_PLANS = {
  basicMonthly: "Basic Monthly",
  standardMonthly: "Standard Monthly",
  unlimitedMonthly: "Unlimited Monthly",
  basicYearly: "Basic Yearly",
  standardYearly: "Standard Yearly",
  unlimitedYearly: "Unlimited Yearly",
};

export const ALL_PRICING_PLAN_KEYS = Object.values(PRICING_PLANS);

export const PLAN_TIERS = [
  {
    id: "free",
    name: "Free Plan",
    monthlyPlan: null,
    yearlyPlan: null,
    monthlyPrice: "$0",
    yearlyPrice: "$0",
    priceChangeLimit: "150 price changes per month",
    features: ["Bulk edit tasks", "Manual sales"],
  },
  {
    id: "basic",
    name: "Basic",
    monthlyPlan: PRICING_PLANS.basicMonthly,
    yearlyPlan: PRICING_PLANS.basicYearly,
    monthlyPrice: "$7.99",
    yearlyPrice: "$79.90",
    priceChangeLimit: "1,000 price changes per month",
    features: ["Bulk edit tasks", "Manual sales", "Scheduled sales"],
  },
  {
    id: "standard",
    name: "Standard",
    monthlyPlan: PRICING_PLANS.standardMonthly,
    yearlyPlan: PRICING_PLANS.standardYearly,
    monthlyPrice: "$12.99",
    yearlyPrice: "$129.90",
    priceChangeLimit: "15,000 price changes per month",
    features: [
      "Bulk edit tasks",
      "Manual sales",
      "Scheduled sales",
      "Cost editing",
      "Margin editing",
    ],
  },
  {
    id: "unlimited",
    name: "Unlimited",
    monthlyPlan: PRICING_PLANS.unlimitedMonthly,
    yearlyPlan: PRICING_PLANS.unlimitedYearly,
    monthlyPrice: "$17.99",
    yearlyPrice: "$179.90",
    priceChangeLimit: "Unlimited price changes",
    features: [
      "Bulk edit tasks",
      "Manual sales",
      "Scheduled sales",
      "Cost editing",
      "Margin editing",
      "Shopify Markets support",
      "Track new products in sales",
      "Auto re-apply price changes",
    ],
  },
];
