import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  Button,
  BlockStack,
  Box,
  InlineStack,
  EmptyState,
  Layout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const NEW_SALE_URL = "/app/sales/new";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return json({ saleCount: 0 });
};

export default function SalesPage() {
  const { saleCount } = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isOpeningNewSale = navigation.location?.pathname === NEW_SALE_URL;
  const openNewSale = () => navigate(NEW_SALE_URL);

  if (!saleCount || saleCount <= 0) {
    return (
      <Page
        title="Sales"
        primaryAction={{
          content: "Create sale",
          url: NEW_SALE_URL,
          onAction: openNewSale,
          loading: isOpeningNewSale,
          disabled: isOpeningNewSale,
        }}
      >
        <TitleBar title="Sales" />
        <Layout>
          <Layout.Section>
            <Card>
              <Box>
                <EmptyState
                  heading="Manage sales"
                  action={{
                    content: "Create first sale",
                    url: NEW_SALE_URL,
                    onAction: openNewSale,
                    loading: isOpeningNewSale,
                    disabled: isOpeningNewSale,
                  }}
                  image="/image/createtask.svg"
                >
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Create sales to schedule price changes in your shop.
                  </Text>
                </EmptyState>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Sales"
      primaryAction={{
        content: "Create sale",
        url: NEW_SALE_URL,
        onAction: openNewSale,
        loading: isOpeningNewSale,
        disabled: isOpeningNewSale,
      }}
    >
      <TitleBar title="Sales" />
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="500">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Your sales
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Sale list will show here when sales are available.
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    url={NEW_SALE_URL}
                    onClick={openNewSale}
                    loading={isOpeningNewSale}
                    disabled={isOpeningNewSale}
                  >
                    Create sale
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
