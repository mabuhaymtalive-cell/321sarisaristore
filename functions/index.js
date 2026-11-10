
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 5 });

const db = getFirestore();

const SAMPLE = {
  id: "p_1793230199357",
  name: "Test Product",
  price: 10,
  unit: "pcs",
  category: "Beverages"
};

exports.submitCustomerOrder = onCall({ cors: true }, async (request) => {
  const d = request.data || {};
  const name = String(d.customerName || "").trim().slice(0, 100);
  const phone = String(d.phone || "").trim().slice(0, 30);
  const area = String(d.deliveryArea || "");
  const address = String(d.address || "").trim().slice(0, 300);
  const payment = String(d.paymentMethod || "");
  const notes = String(d.notes || "").trim().slice(0, 500);
  const items = Array.isArray(d.items) ? d.items : [];

  if (!name || !phone)
    throw new HttpsError("invalid-argument", "Name and phone are required.");

  if (!["COD", "GCash"].includes(payment))
    throw new HttpsError("invalid-argument", "Only COD and GCash are accepted.");

  const areas = [
    "San Carlos City Proper",
    "Vallehermoso",
    "Canlaon City",
    "Don Salvador Benedicto (DSB)",
    "Calatrava",
    "Toboso",
    "Store Pickup"
  ];

  if (!areas.includes(area))
    throw new HttpsError("invalid-argument", "Invalid delivery area.");

  if (area !== "Store Pickup" && !address)
    throw new HttpsError("invalid-argument", "Delivery address is required.");

  if (!items.length || items.length > 30)
    throw new HttpsError("invalid-argument", "Cart must contain 1 to 30 items.");

  let subtotal = 0;
  const clean = [];

  for (const item of items) {
    const id = String(item.productId || "").trim();
    const qty = Number(item.qty);

    if (!id || id.length > 150 || !Number.isInteger(qty) || qty < 1 || qty > 99)
      throw new HttpsError("invalid-argument", "Invalid item or quantity.");

    let product;

    // The launch sample does not need a Firestore product document.
    if (id === SAMPLE.id) {
      product = SAMPLE;
    } else {
      const snap = await db.collection("storeProducts").doc(id).get();

      if (!snap.exists)
        throw new HttpsError("failed-precondition", "Product not found.");

      const p = snap.data() || {};
      const price = Number(p.price);
      const stock = Number(p.stock);

      if (!p.name || !Number.isFinite(price) || price < 0 ||
          !Number.isFinite(stock) || stock < qty)
        throw new HttpsError("failed-precondition", "Invalid price or stock.");

      product = {
        id,
        name: String(p.name),
        price,
        unit: String(p.unit || "pcs")
      };
    }

    const lineTotal = Math.round(product.price * qty * 100) / 100;
    subtotal += lineTotal;

    clean.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      qty,
      price: product.price,
      lineTotal
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  const deliveryFee =
    area === "Store Pickup" ? 0 :
    area === "San Carlos City Proper" ? 30 : null;

  const total = deliveryFee === null
    ? subtotal
    : Math.round((subtotal + deliveryFee) * 100) / 100;

  const orderId = "web_" + crypto.randomUUID().replace(/-/g, "");

  await db.collection("customerOrders").doc(orderId).create({
    customerName: name,
    phone,
    address,
    deliveryArea: area,
    notes,
    items: clean,
    itemsText: clean.map(x =>
      x.name + " x " + x.qty + " " + x.unit +
      " — ₱" + x.lineTotal.toFixed(2)
    ).join("\n"),
    subtotal,
    deliveryFee,
    total,
    grandTotal: deliveryFee === null ? null : total,
    paymentMethod: payment,
    paymentStatus: payment === "GCash" ? "Pending verification" : "Unpaid",
    status: "New",
    source: "online-checkout",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { orderId, subtotal, deliveryFee, total };
});
