export const PRICING_PLANS = {
  basicMonthly: "Basic Monthly",
  advancedMonthly: "Advanced Monthly",
  premiumMonthly: "Premium Monthly",
  basicYearly: "Basic Yearly",
  advancedYearly: "Advanced Yearly",
  premiumYearly: "Premium Yearly",
};

export const ALL_PRICING_PLAN_KEYS = Object.values(PRICING_PLANS);

export const PLAN_TIERS = [
  {
    id: "basic",
    name: "Basic",
    monthlyPlan: PRICING_PLANS.basicMonthly,
    yearlyPlan: PRICING_PLANS.basicYearly,
    monthlyPrice: "$9.99",
    yearlyPrice: "$89",
    productLimit: "25,000 products per sale/task",
    features: ["Bulk edit tasks", "Manual sales", "Scheduled sales"],
  },
  {
    id: "advanced",
    name: "Advanced",
    monthlyPlan: PRICING_PLANS.advancedMonthly,
    yearlyPlan: PRICING_PLANS.advancedYearly,
    monthlyPrice: "$14.99",
    yearlyPrice: "$134",
    productLimit: "75,000 products per sale/task",
    features: [
      "Bulk edit tasks",
      "Manual sales",
      "Scheduled sales",
      "Cost editing",
      "Margin editing",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    monthlyPlan: PRICING_PLANS.premiumMonthly,
    yearlyPlan: PRICING_PLANS.premiumYearly,
    monthlyPrice: "$24.99",
    yearlyPrice: "$224",
    productLimit: "150,000 products per sale/task",
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
