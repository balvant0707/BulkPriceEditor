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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "@remix-run/react";
import db from "../db.server";
import { authenticate } from "../shopify.server";

const CREATE_SALE_URL = "/app/sales/new";
const SALES_URL = "/app/sales";
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";

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
  const isOpeningNewSale =
    navigation.location?.pathname === CREATE_SALE_URL ||
    location.pathname === CREATE_SALE_URL;
  const openNewSale = () => navigate(CREATE_SALE_URL);

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
              <Card>
                <Box padding="500">
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Your sales
                    </Text>

                    {sales.map((sale) => (
                      <Box
                        key={sale.id}
                        padding="300"
                        borderColor="border"
                        borderWidth="025"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {sale.title}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {sale.changeType} - {sale.status}
                            </Text>
                            {sale.executionSummary ? (
                              <Text as="p" variant="bodySm" tone="subdued">
                                Analyzed {sale.executionSummary.analyzedVariants || 0},
                                updated {sale.executionSummary.updatedVariants || 0}
                              </Text>
                            ) : null}
                          </BlockStack>

                          <Button url={`/app/sales/${sale.id}`}>Edit</Button>
                        </InlineStack>
                      </Box>
                    ))}
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
