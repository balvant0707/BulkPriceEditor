import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const PAGE_SIZE = 10;
const TAG_PAGE_SIZE = 5000;

const RESOURCE_QUERIES = {
  collection: `#graphql
    query ResourcePickerCollections($first: Int!, $after: String, $query: String) {
      shop {
        currencyCode
      }
      collections(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          image {
            url
            altText
          }
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
      shop {
        currencyCode
      }
      products(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          featuredImage {
            url
            altText
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          status
          totalInventory
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
      shop {
        currencyCode
      }
      productVariants(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          image {
            url
            altText
          }
          price
          product {
            id
            title
            status
            totalInventory
            featuredImage {
              url
              altText
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  tag: `#graphql
    query ResourcePickerProductTags($first: Int!, $after: String) {
      shop {
        currencyCode
      }
      productTags(first: $first, after: $after) {
        nodes
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
  tag: "productTags",
};

function formatMoney(money, fallbackCurrencyCode = "") {
  if (!money?.amount) return "";

  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return "";

  const currencyCode = money.currencyCode || fallbackCurrencyCode;
  if (!currencyCode) return amount.toFixed(2);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);
}

function formatProductPriceRange(priceRange) {
  const minPrice = formatMoney(priceRange?.minVariantPrice);
  const maxPrice = formatMoney(priceRange?.maxVariantPrice);

  if (!minPrice) return "";
  if (!maxPrice || minPrice === maxPrice) return minPrice;

  return `${minPrice} - ${maxPrice}`;
}

function normalizeItems(
  type,
  nodes = [],
  searchQuery = "",
  currencyCode = "",
  includeDraftProducts = true,
  productStateFilters = {
    active: true,
    draft: includeDraftProducts,
    soldout: true,
  },
) {
  if (type === "collection") {
    return nodes.map((collection) => ({
      id: collection.id,
      title: collection.title,
      imageUrl: collection.image?.url || "",
      imageAlt: collection.image?.altText || collection.title,
      productsCount: collection.productsCount?.count ?? 0,
    }));
  }

  if (type === "variant") {
    return nodes
      .filter((variant) => {
        return shouldIncludeProductByState(variant.product, productStateFilters);
      })
      .map((variant) => ({
        id: variant.id,
        title: variant.title,
        imageUrl: variant.image?.url || variant.product?.featuredImage?.url || "",
        imageAlt:
          variant.image?.altText ||
          variant.product?.featuredImage?.altText ||
          variant.title,
        displayPrice: formatMoney({ amount: variant.price }, currencyCode),
        productId: variant.product?.id,
        productTitle: variant.product?.title || "Product",
      }));
  }

  if (type === "tag") {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return nodes
      .filter((tag) =>
        normalizedQuery ? tag.toLowerCase().includes(normalizedQuery) : true,
      )
      .map((tag) => ({
        id: tag,
        title: tag,
      }));
  }

  return nodes
    .filter((product) => shouldIncludeProductByState(product, productStateFilters))
    .map((product) => ({
      id: product.id,
      title: product.title,
      imageUrl: product.featuredImage?.url || "",
      imageAlt: product.featuredImage?.altText || product.title,
      displayPrice: formatProductPriceRange(product.priceRangeV2),
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
  const requestId = url.searchParams.get("requestId") || "";
  const includeDraftProducts = url.searchParams.get("includeDraftProducts") !== "false";
  const productStateFilters = {
    active: url.searchParams.get("applyToActiveProducts") !== "false",
    draft:
      url.searchParams.get("applyToDraftProducts") !== "false" &&
      includeDraftProducts,
    soldout: url.searchParams.get("applyToSoldoutProducts") !== "false",
  };
  const query = buildResourceQuery(type, searchQuery, productStateFilters);

  if (!RESOURCE_QUERIES[type]) {
    return json(
      {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        type,
        query: searchQuery || "",
        after: after || "",
        requestId,
      },
      { status: 400 },
    );
  }

  const response = await admin.graphql(RESOURCE_QUERIES[type], {
    variables:
      type === "tag"
        ? {
            first: TAG_PAGE_SIZE,
            after,
          }
        : {
            first: PAGE_SIZE,
            after,
            query,
          },
  });
  const payload = await response.json();

  if (payload.errors) {
    return json(
      {
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        error: "Unable to load Shopify resources.",
        type,
        query: searchQuery || "",
        after: after || "",
        requestId,
      },
      { status: 500 },
    );
  }

  const connection = payload.data?.[CONNECTION_BY_TYPE[type]];

  return json({
    items: normalizeItems(
      type,
      connection?.nodes,
      searchQuery || "",
      payload.data?.shop?.currencyCode || "",
      includeDraftProducts,
      productStateFilters,
    ),
    pageInfo:
      type === "tag"
        ? { hasNextPage: false, endCursor: null }
        : connection?.pageInfo || { hasNextPage: false, endCursor: null },
    type,
    query: searchQuery || "",
    after: after || "",
    requestId,
  });
}

function buildResourceQuery(type, searchQuery, productStateFilters) {
  if (type !== "product") return searchQuery;

  const statusQueries = [];
  if (productStateFilters.active) statusQueries.push("status:active");
  if (productStateFilters.draft) statusQueries.push("status:draft");

  if (statusQueries.length !== 1) return searchQuery;

  return searchQuery ? `${searchQuery} ${statusQueries[0]}` : statusQueries[0];
}

function shouldIncludeProductByState(product, filters) {
  const status = String(product?.status || "").toUpperCase();
  const totalInventory = Number(product?.totalInventory);
  const soldout = Number.isFinite(totalInventory) && totalInventory <= 0;

  if (soldout && !filters.soldout) return false;
  if (status === "DRAFT") return filters.draft;
  if (!status || status === "ACTIVE") return filters.active;
  return false;
}
