import sqlite3 from "sqlite3";
import path from "path";
import { Shopify } from "@shopify/shopify-api";

const QR_CODES_DB_FILE = path.join(process.cwd(), "qr_codes_db.sqlite");
const DEFAULT_PURCHASE_QUANTITY = 1;

export const QRCodesDB = {
  qrCodesTableName: "qr_codes",
  db: new sqlite3.Database(QR_CODES_DB_FILE),
  ready: null,

  create: async function ({
    shopDomain,
    title,
    productId,
    discountId,
    variantId,
    handle,
    goToCheckout = false,
  }) {
    await this.ready;

    const query = `
      INSERT INTO ${this.qrCodesTableName}
      (shopDomain, title, productId, discountId, variantId, handle, goToCheckout, scans, conversions)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
      RETURNING id;
    `;

    const rawResults = await this.__query(query, [
      shopDomain,
      title,
      productId,
      discountId,
      variantId,
      handle,
      goToCheckout,
    ]);

    return rawResults[0].id;
  },

  update: async function (
    id,
    { title, productId, discountId, variantId, handle, goToCheckout = false }
  ) {
    await this.ready;

    const query = `
      UPDATE ${this.qrCodesTableName}
      SET
        title = ?,
        productId = ?,
        discountId = ?,
        variantId = ?
        handle = ?
        goToCheckout = ?
      WHERE
        id = ?;
    `;

    await this.__query(query, [
      title,
      productId,
      discountId,
      variantId,
      handle,
      goToCheckout,
      id,
    ]);
    return true;
  },

  list: async function (shopDomain) {
    await this.ready;
    const query = `
      SELECT * FROM ${this.qrCodesTableName}
      WHERE shopDomain = ?;
    `;

    const results = await this.__query(query, [shopDomain]);

    return results.map((qrcode) => this.__addImageUrl(qrcode));
  },

  read: async function (id) {
    await this.ready;
    const query = `
      SELECT * FROM ${this.qrCodesTableName}
      WHERE id = ?;
    `;
    const rows = await this.__query(query, [id]);
    if (!Array.isArray(rows) || rows?.length !== 1) return undefined;

    return this.__addImageUrl(rows[0]);
  },

  delete: async function (id) {
    await this.ready;
    const query = `
      DELETE FROM ${this.qrCodesTableName}
      WHERE id = ?;
    `;
    await this.__query(query, [id]);
    return true;
  },

  generateQrcodeDestinationUrl: function (qrcode) {
    return `${Shopify.Context.HOST_SCHEME}://${Shopify.Context.HOST_NAME}/qrcode/${qrcode.id}`;
  },

  handleCodeScan: async function (qrcode) {
    await this.__increaseScanCount(qrcode);

    const url = new URL(qrcode.shopDomain);
    if (qrcode.goToCheckout) {
      return this.__goToProductCheckout(url, qrcode);
    } else {
      return this.__goToProductView(url, qrcode);
    }
  },

  // Private

  __hasQrCodesTable: async function () {
    const query = `
      SELECT name FROM sqlite_schema
      WHERE
        type = 'table' AND
        name = ?;
    `;
    const rows = await this.__query(query, [this.qrCodesTableName]);
    return rows.length === 1;
  },

  __init: async function () {
    const hasQrCodesTable = await this.__hasQrCodesTable();
    if (hasQrCodesTable) {
      this.ready = Promise.resolve();
    } else {
      const query = `
        CREATE TABLE ${this.qrCodesTableName} (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          shopDomain VARCHAR(511) NOT NULL,
          title VARCHAR(511) NOT NULL,
          productId VARCHAR(255) NOT NULL,
          discountId VARCHAR(255) NOT NULL,
          variantId VARCHAR(255) NOT NULL,
          handle VARCHAR(255) NOT NULL,
          goToCheckout TINYINT NOT NULL,
          scans INTEGER,
          conversions INTEGER,
          createdAt DATETIME NOT NULL DEFAULT (datetime(CURRENT_TIMESTAMP, 'localtime'))
        )
      `;
      this.ready = this.__query(query);
    }
  },

  __query: function (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  },

  __addImageUrl: function (qrcode) {
    try {
      qrcode.imageUrl = this.__generateQrcodeImageUrl(qrcode);
    } catch (err) {
      console.error(err);
    }

    return qrcode;
  },

  __generateQrcodeImageUrl: function (qrcode) {
    return `${Shopify.Context.HOST_SCHEME}://${Shopify.Context.HOST_NAME}/api/qrcode/${qrcode.id}/image`;
  },

  __increaseScanCount: async function (qrcode) {
    const query = `
      UPDATE ${this.qrCodesTableName}
      SET scans = scans + 1
      WHERE id = ?
    `;
    await this.__query(query, [qrcode.id]);
  },

  __goToProductView: function (url, qrcode) {
    const productPath = `/products/${qrcode.productHandle}`;

    if (qrcode.discountCode) {
      url.pathname = `/discount/${qrcode.discountCode}`;
      url.searchParams.append("redirect", productPath);
    } else {
      url.pathname = productPath;
    }

    return url.toString();
  },

  __goToProductCheckout: function (url, qrcode) {
    url.pathname = `/cart/${qrcode.variantId}:${DEFAULT_PURCHASE_QUANTITY}`;

    if (qrcode.discountCode) {
      url.searchParams.append("discount", qrcode.discountCode);
    }

    return url.toString();
  },
};

QRCodesDB.__init();