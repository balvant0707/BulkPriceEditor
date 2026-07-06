import { AppProvider, BlockStack, Card, Page, Text } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import enTranslations from "@shopify/polaris/locales/en.json";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export default function ContattiPage() {
  return (
    <AppProvider i18n={enTranslations}>
      <Page title="Contatti">
        <Card>
          <BlockStack gap="400">
            <Text as="p">This is the contact page.</Text>
          </BlockStack>
        </Card>
      </Page>
    </AppProvider>
  );
}