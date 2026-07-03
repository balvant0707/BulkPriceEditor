// app/routes/app.sales.jsx
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
  useLocation,
  useNavigate,
  useNavigation,
} from "@remix-run/react";

const CREATE_SALE_URL = "/app/sales/new";
const HELP_URL = "https://help.platmart.io/article/29-how-to-use-sales";

export default function SalesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isOpeningNewSale =
    navigation.location?.pathname === CREATE_SALE_URL ||
    location.pathname === CREATE_SALE_URL;
  const openNewSale = () => navigate(CREATE_SALE_URL);

  if (location.pathname === CREATE_SALE_URL) {
    return <Outlet />;
  }

  return (
    <>
      <TitleBar
        title="Sales"
        primaryAction={{
          content: "Create sale",
          onAction: openNewSale,
          loading: isOpeningNewSale,
          disabled: isOpeningNewSale,
        }}
      />

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
