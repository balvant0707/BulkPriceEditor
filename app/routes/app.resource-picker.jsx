import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const PAGE_SIZE = 10;

const RESOURCE_QUERIES = {
  collection: `#graphql
    query ResourcePickerCollections($first: Int!, $after: String, $query: String) {
      collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          productsCount {
            count
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  product: `#graphql
    query ResourcePickerProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          status
          variantsCount {
            count
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  variant: `#graphql
    query ResourcePickerProductVariants($first: Int!, $after: String, $query: String) {
      productVariants(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          product {
            id
            title
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
};

const CONNECTION_BY_TYPE = {
  collection: "collections",
  product: "products",
  variant: "productVariants",
};

function normalizeItems(type, nodes = []) {
  if (type === "collection") {
    return nodes.map((collection) => ({
      id: collection.id,
      title: collection.title,
      productsCount: collection.productsCount?.count ?? 0,
    }));
  }

  if (type === "variant") {
    return nodes.map((variant) => ({
      id: variant.id,
      title: variant.title,
      productId: variant.product?.id,
      productTitle: variant.product?.title || "Product",
    }));
  }

  return nodes.map((product) => ({
    id: product.id,
    title: product.title,
    status: product.status
      ? product.status.charAt(0) + product.status.slice(1).toLowerCase()
      : "",
    variantsCount: product.variantsCount?.count ?? 0,
  }));
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "product";
  const after = url.searchParams.get("after");
  const searchQuery = url.searchParams.get("query")?.trim() || null;

  if (!RESOURCE_QUERIES[type]) {
    return json({ items: [], pageInfo: { hasNextPage: false, endCursor: null } }, { status: 400 });
  }

  const response = await admin.graphql(RESOURCE_QUERIES[type], {
    variables: {
      first: PAGE_SIZE,
      after,
      query: searchQuery,
    },
  });
  const payload = await response.json();

  if (payload.errors) {
    return json(
      {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        error: "Unable to load Shopify resources.",
      },
      { status: 500 },
    );
  }

  const connection = payload.data?.[CONNECTION_BY_TYPE[type]];

  return json({
    items: normalizeItems(type, connection?.nodes),
    pageInfo: connection?.pageInfo || { hasNextPage: false, endCursor: null },
  });
}
