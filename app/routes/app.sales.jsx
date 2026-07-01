import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return json({ saleCount: 0 });
};

export default function SalesPage() {
  const { saleCount } = useLoaderData();

  if (!saleCount || saleCount <= 0) {
    return (
      <Page
        title="Sales"
        primaryAction={{
          content: "Create sale",
          url: "/app/sales/new",
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
                    url: "/app/sales/new",
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
        url: "/app/sales/new",
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
                  <Button variant="primary" url="/app/sales/new">
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

