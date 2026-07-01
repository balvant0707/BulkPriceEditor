import { json, redirect } from "@remix-run/node";
import { Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return json({});
}

export async function action({ request }) {
  await authenticate.admin(request);
  return redirect("/app/sales");
}

export default function NewSalePage() {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [name, setName] = useState("");

  return (
    <>
      <TitleBar title="New sale" />
      <Page
        title="New sale"
        backAction={{
          content: "Back",
          url: "/app/sales",
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Sale details
                  </Text>
                  <TextField
                    label="Sale name"
                    name="name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                  />
                  <InlineStack align="end" gap="200">
                    <Button url="/app/sales" disabled={isSubmitting}>
                      Discard
                    </Button>
                    <Button submit variant="primary" loading={isSubmitting}>
                      Save
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}
