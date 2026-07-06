// app/routes/app.sales.jsx
import { json } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  FooterHelp,
  Link,
  Button,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Tabs,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { useMemo } from "react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const CREATE_SALE_URL = "/app/sales/new";
const SALES_URL = "/app/sales";
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";
const SALE_TABS = [
  { id: "all", content: "All sales" },
  { id: "active", content: "Active" },
  { id: "scheduled", content: "Scheduled" },
  { id: "completed", content: "Completed" },
];

function saleMatchesTab(sale, activeTab) {
  if (activeTab === "all") {
    return true;
  }

  const status = String(sale.status || "").toLowerCase();

  if (activeTab === "completed") {
    return (
      status === "complete" ||
      status === "completed" ||
      status === "finished" ||
      status === "ended"
    );
  }

  return status === activeTab;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const sales = await db.sale.findMany({
    where: { shop: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return json({ sales });
};

export default function SalesPage() {
  const { sales } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOpeningNewSale =
    navigation.location?.pathname === CREATE_SALE_URL ||
    location.pathname === CREATE_SALE_URL;
  const openNewSale = () => navigate(CREATE_SALE_URL);
  const requestedTab = searchParams.get("status") || "all";
  const activeTab = SALE_TABS.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : "all";
  const selectedTabIndex = Math.max(
    SALE_TABS.findIndex((tab) => tab.id === activeTab),
    0,
  );
  const tabs = useMemo(
    () =>
      SALE_TABS.map((tab) => ({
        ...tab,
        url: tab.id === "all" ? SALES_URL : `${SALES_URL}?status=${tab.id}`,
      })),
    [],
  );
  const filteredSales = useMemo(
    () => sales.filter((sale) => saleMatchesTab(sale, activeTab)),
    [sales, activeTab],
  );

  const handleTabChange = (selectedIndex) => {
    const selectedTab = SALE_TABS[selectedIndex];
    const nextParams = new URLSearchParams(searchParams);

    if (selectedTab.id === "all") {
      nextParams.delete("status");
    } else {
      nextParams.set("status", selectedTab.id);
    }

    setSearchParams(nextParams);
  };

  if (location.pathname !== SALES_URL) {
    return <Outlet />;
  }

  return (
    <>
      <TitleBar title="Sales">
        <button
          variant="primary"
          onClick={openNewSale}
          disabled={isOpeningNewSale}
        >
          Create sale
        </button>
      </TitleBar>
<style>{`
    .Polaris-EmptyState__Image,
    .Polaris-EmptyState__Image img {
      opacity: 1 !important;
      filter: none !important;
    }
  `}</style>
      <Page
        title="Sales"
        primaryAction={{
          content: "Create sale",
          onAction: openNewSale,
          loading: isOpeningNewSale,
          disabled: isOpeningNewSale,
        }}
      >
        <Layout>
          <Layout.Section>
            {sales.length ? (
              <Card padding="0">
                <Tabs
                  tabs={tabs}
                  selected={selectedTabIndex}
                  onSelect={handleTabChange}
                />
                <Box padding="500">
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Your sales
                    </Text>

                    {filteredSales.length ? (
                      filteredSales.map((sale) => (
                        <Box
                          key={sale.id}
                          padding="300"
                          borderColor="border"
                          borderWidth="025"
                          borderRadius="200"
                        >
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                          >
                            <BlockStack gap="050">
                              <Text
                                as="p"
                                variant="bodyMd"
                                fontWeight="semibold"
                              >
                                {sale.title}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {sale.changeType} - {sale.status}
                              </Text>
                              {sale.executionSummary ? (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Analyzed{" "}
                                  {sale.executionSummary.analyzedVariants || 0},
                                  updated{" "}
                                  {sale.executionSummary.updatedVariants || 0}
                                </Text>
                              ) : null}
                            </BlockStack>

                            <Button url={`/app/sales/${sale.id}`}>Edit</Button>
                          </InlineStack>
                        </Box>
                      ))
                    ) : (
                      <Box paddingBlock="400">
                        <Text as="p" tone="subdued">
                          No sales found for this status.
                        </Text>
                      </Box>
                    )}
                  </BlockStack>
                </Box>
              </Card>
            ) : (
              <Card>
                <EmptyState
                  heading="Manage sales"
                  image="/image/sale.svg"
                  action={{
                    content: "Create first sale",
                    onAction: openNewSale,
                    loading: isOpeningNewSale,
                    disabled: isOpeningNewSale,
                  }}
                  secondaryAction={{
                    content: "Learn more",
                    url: HELP_URL,
                    external: true,
                  }}
                >
                  <p>
                    Create manual or scheduled sales that will start and stop at
                    the specified time.
                  </p>
                </EmptyState>
              </Card>
            )}
          </Layout.Section>
        </Layout>

        <FooterHelp>
          Learn more about{" "}
          <Link url={HELP_URL} external removeUnderline>
            sales
          </Link>
        </FooterHelp>
      </Page>
    </>
  );
}
