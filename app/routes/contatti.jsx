import { BlockStack, Card, Page, Text } from "@shopify/polaris";

export default function ContattiPage() {
  return (
    <Page title="Contatti">
      <Card>
        <BlockStack gap="400">
          <Text as="p">This is the contact page.</Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
