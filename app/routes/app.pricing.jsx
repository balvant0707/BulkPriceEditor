import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ALL_PRICING_PLAN_KEYS, PLAN_TIERS } from "../lib/pricing-plans";
import { withShopifyEmbeddedParams } from "../lib/shopify-embedded-url";

export async function loader({ request }) {
  const { billing } = await authenticate.admin(request);
  const billingCheck = await billing.check({
    plans: ALL_PRICING_PLAN_KEYS,
    isTest: isBillingTestMode(),
  });
  const activeSubscription = billingCheck.appSubscriptions?.[0] || null;

  return json({
    activePlan: activeSubscription?.name || "",
    hasActivePayment: Boolean(billingCheck.hasActivePayment),
  });
}

export async function action({ request }) {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan") || "");

  if (!ALL_PRICING_PLAN_KEYS.includes(plan)) {
    return json({ ok: false, message: "Invalid plan selected." }, { status: 400 });
  }

  const returnPath = withShopifyEmbeddedParams("/app/pricing", request, session.shop);
  const returnUrl = new URL(
    returnPath,
    process.env.SHOPIFY_APP_URL || request.url,
  ).toString();

  return billing.request({
    plan,
    isTest: isBillingTestMode(),
    returnUrl,
  });
}

function isBillingTestMode() {
  if (process.env.SHOPIFY_BILLING_TEST) {
    return process.env.SHOPIFY_BILLING_TEST === "true";
  }

  return process.env.NODE_ENV !== "production";
}

function getSelectedInterval(searchParams) {
  return searchParams.get("interval") === "yearly" ? "yearly" : "monthly";
}

function PlanCard({ plan, interval, activePlan, submittingPlan }) {
  const planKey = interval === "yearly" ? plan.yearlyPlan : plan.monthlyPlan;
  const price = interval === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
  const intervalLabel = interval === "yearly" ? "/year" : "/month";
  const isCurrent = activePlan === planKey;
  const isLoading = submittingPlan === planKey;

  return (
    <Card padding="0">
      <BlockStack gap="0">
        <Box padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                {plan.name}
              </Text>
              {isCurrent ? <Badge tone="success">Current</Badge> : null}
            </InlineStack>

            <InlineStack gap="100" blockAlign="end">
              <Text as="p" variant="headingXl" fontWeight="bold">
                {price}
              </Text>
              <Box paddingBlockEnd="100">
                <Text as="span">{intervalLabel}</Text>
              </Box>
            </InlineStack>

            <Form method="post">
              <input type="hidden" name="plan" value={planKey} />
              <Button
                submit
                fullWidth
                variant={isCurrent ? "secondary" : "primary"}
                disabled={isCurrent || Boolean(submittingPlan)}
                loading={isLoading}
              >
                {isCurrent ? "Current plan" : "Choose plan"}
              </Button>
            </Form>
          </BlockStack>
        </Box>

        <Divider />

        <Box padding="500">
          <BlockStack gap="300">
            <Bullet>Unlimited sales</Bullet>
            <Bullet>Unlimited tasks</Bullet>
            <Bullet>{plan.productLimit}</Bullet>
          </BlockStack>
        </Box>

        <Divider />

        <Box padding="500">
          <BlockStack gap="300">
            {plan.features.map((feature) => (
              <Check key={feature}>{feature}</Check>
            ))}
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}

function Bullet({ children }) {
  return (
    <InlineStack gap="300" blockAlign="start" wrap={false}>
      <Text as="span">•</Text>
      <Text as="span">{children}</Text>
    </InlineStack>
  );
}

function Check({ children }) {
  return (
    <InlineStack gap="300" blockAlign="start" wrap={false}>
      <Text as="span">✓</Text>
      <Text as="span">{children}</Text>
    </InlineStack>
  );
}

export default function PricingPage() {
  const { activePlan } = useLoaderData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const interval = getSelectedInterval(searchParams);
  const submittingPlan =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("plan") || "")
      : "";

  const setInterval = (nextInterval) => {
    const next = new URLSearchParams(searchParams);
    next.set("interval", nextInterval);
    setSearchParams(next);
  };

  return (
    <>
      <TitleBar title="Manage your plan" />
      <Page title="Manage your plan" fullWidth>
        <Layout>
          <Layout.Section>
            <BlockStack gap="600">
              <InlineStack align="center">
                <ButtonGroup variant="segmented">
                  <Button
                    pressed={interval === "monthly"}
                    onClick={() => setInterval("monthly")}
                  >
                    Monthly
                  </Button>
                  <Button
                    pressed={interval === "yearly"}
                    onClick={() => setInterval("yearly")}
                  >
                    Yearly (Save 25%)
                  </Button>
                </ButtonGroup>
              </InlineStack>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 20,
                  alignItems: "start",
                }}
              >
                {PLAN_TIERS.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    interval={interval}
                    activePlan={activePlan}
                    submittingPlan={submittingPlan}
                  />
                ))}
              </div>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}
