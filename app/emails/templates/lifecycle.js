function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getShopName(shop) {
  return shop?.name || shop?.shop || "your Shopify store";
}

function getShopDomain(shop) {
  return shop?.primaryDomain || shop?.shop || "";
}

function baseTemplate({ title, preview, body }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;background:#f6f6f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#202223;">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;">${escapeHtml(preview)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e1e3e5;border-radius:8px;">
            <tr>
              <td style="padding:28px 32px;">
                <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;">${escapeHtml(title)}</h1>
                ${body}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function appInstalledUserTemplate(shop) {
  const shopName = escapeHtml(getShopName(shop));
  const shopDomain = escapeHtml(getShopDomain(shop));

  return {
    subject: `Bulk Price Editor installed for ${getShopName(shop)}`,
    html: baseTemplate({
      title: "Bulk Price Editor installed",
      preview: `Bulk Price Editor is ready for ${getShopName(shop)}.`,
      body: `
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hello,</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Bulk Price Editor has been installed for <strong>${shopName}</strong>${shopDomain ? ` (${shopDomain})` : ""}.</p>
        <p style="font-size:15px;line-height:1.6;margin:0;">You can now create bulk price tasks, scheduled sales, reports, and automatic re-apply jobs from your Shopify admin.</p>
      `,
    }),
    text: `Bulk Price Editor has been installed for ${getShopName(shop)}${getShopDomain(shop) ? ` (${getShopDomain(shop)})` : ""}.`,
  };
}

export function appInstalledOwnerTemplate(shop) {
  return {
    subject: `App installed: ${getShopName(shop)}`,
    html: baseTemplate({
      title: "New app installation",
      preview: `${getShopName(shop)} installed Bulk Price Editor.`,
      body: `
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;"><strong>${escapeHtml(getShopName(shop))}</strong> installed Bulk Price Editor.</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Shop: ${escapeHtml(shop?.shop || "")}</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Domain: ${escapeHtml(getShopDomain(shop)) || "-"}</p>
        <p style="font-size:15px;line-height:1.6;margin:0;">Email: ${escapeHtml(shop?.contactEmail || shop?.email || "") || "-"}</p>
      `,
    }),
    text: `${getShopName(shop)} installed Bulk Price Editor. Shop: ${shop?.shop || ""}. Email: ${shop?.contactEmail || shop?.email || ""}.`,
  };
}

export function appUninstalledUserTemplate(shop) {
  return {
    subject: `Bulk Price Editor uninstalled for ${getShopName(shop)}`,
    html: baseTemplate({
      title: "Bulk Price Editor uninstalled",
      preview: `Bulk Price Editor was uninstalled for ${getShopName(shop)}.`,
      body: `
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Hello,</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Bulk Price Editor has been uninstalled from <strong>${escapeHtml(getShopName(shop))}</strong>.</p>
        <p style="font-size:15px;line-height:1.6;margin:0;">If this was unintentional, you can reinstall the app from Shopify. Shopify privacy compliance redaction requests will be handled automatically when received.</p>
      `,
    }),
    text: `Bulk Price Editor has been uninstalled from ${getShopName(shop)}.`,
  };
}

export function appUninstalledOwnerTemplate(shop) {
  return {
    subject: `App uninstalled: ${getShopName(shop)}`,
    html: baseTemplate({
      title: "App uninstalled",
      preview: `${getShopName(shop)} uninstalled Bulk Price Editor.`,
      body: `
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;"><strong>${escapeHtml(getShopName(shop))}</strong> uninstalled Bulk Price Editor.</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Shop: ${escapeHtml(shop?.shop || "")}</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 8px;">Domain: ${escapeHtml(getShopDomain(shop)) || "-"}</p>
        <p style="font-size:15px;line-height:1.6;margin:0;">Email: ${escapeHtml(shop?.contactEmail || shop?.email || "") || "-"}</p>
      `,
    }),
    text: `${getShopName(shop)} uninstalled Bulk Price Editor. Shop: ${shop?.shop || ""}. Email: ${shop?.contactEmail || shop?.email || ""}.`,
  };
}
