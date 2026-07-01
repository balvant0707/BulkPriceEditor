// app/routes/app.sales.jsx
import {
  Page,
  Layout,
  Card,
  EmptyState,
  FooterHelp,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

const CREATE_SALE_URL = "/app/sales/new"; // change to "/sales/new" if your route is outside /app
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";

export default function SalesPage() {
  return (
    <>
      <TitleBar
        title="Sales"
        primaryAction={{
          content: "Create sale",
          url: CREATE_SALE_URL,
        }}
      />

      <Page
        title="Sales"
        primaryAction={{
          content: "Create sale",
          url: CREATE_SALE_URL,
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Manage sales"
                image="/image/sale.svg"
                action={{
                  content: "Create first sale",
                  url: CREATE_SALE_URL,
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