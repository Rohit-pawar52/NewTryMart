const Order = require("../../models/Order");
const OrderItemDetail = require("../../models/OrderDetails");
const VariantOption = require("../../models/VariantOption");
const Cart = require("../../models/Cart");
const Transaction = require("../../models/Transaction");
/**
 * Get all orders for the authenticated user
 */

async function placeOrder(req, res) {
  try {
    const userId = req.body.user_id;
    const shippingAddressId = req.body.address_id;

    // Fetch cart items and populate necessary fields
    const cartItems = await Cart.find({ customer_id: userId })
      .populate("product_id")
      .populate("seller_id");

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // Step 1: Validate Stock
    for (const item of cartItems) {
      const product = item.product_id;
      if (!product) {
        return res
          .status(400)
          .json({ message: `Product not found for cart item ${item._id}` });
      }

      if (item.is_variant && item.variant_id) {
        const variant = await VariantOption.findOne({
          _id: item.variant_id,
          product_id: product._id,
        });

        if (!variant || variant.stock < item.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for variant of product ${product.name}`,
          });
        }
      } else if (product.current_stock < item.quantity) {
        return res
          .status(400)
          .json({ message: `Insufficient stock for product ${product.name}` });
      }
    }

    // Step 2: Group cart items by seller_id (or 'admin')
    console.log("Item:", cartItems);
    const groupedItems = {};
    for (const item of cartItems) {
      const sellerKey =
        item.added_by === "admin" ? "admin" : item.seller_id?._id?.toString();
      if (!groupedItems[sellerKey]) groupedItems[sellerKey] = [];
      groupedItems[sellerKey].push(item);
    }

    const orderResults = [];

    // Step 3: Create order per seller
    for (const [sellerKey, items] of Object.entries(groupedItems)) {
      let totalOrderPrice = 0;
      const orderItemIds = [];

      for (const item of items) {
        const product = item.product_id;
        const seller = item.seller_id;

        const itemTotalPrice = item.total_price + (item.shipping_cost || 0);
        totalOrderPrice += itemTotalPrice;

        const productSnapshot = product.toObject();
        delete productSnapshot.__v;
        delete productSnapshot.createdAt;
        delete productSnapshot.updatedAt;

        // Determine seller_id safely
        const sellerId =
          sellerKey === "admin" ? null : items[0]?.seller_id?._id || null;

        const orderItem = new OrderItemDetail({
          product_id: product._id,
          product_detail: productSnapshot,
          name: product.name,
          thumbnail: product.thumbnail,
          selected_variant: item.selected_variant,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: itemTotalPrice,
          tax: item.tax,
          discount: item.discount,
          discount_type: item.discount_type,
          tax_model: item.tax_model,
          slug: item.slug,
          seller_id: sellerId,
          seller_is: sellerKey === "admin" ? "admin" : "seller",
          shipping_cost: item.shipping_cost,
          shipping_type: item.shipping_type,
          shipping_address: shippingAddressId,
          delivery_status: "Pending",
        });

        await orderItem.save();
        orderItemIds.push(orderItem._id);

        // Deduct stock
        if (item.is_variant && item.variant_id) {
          await VariantOption.findOneAndUpdate(
            { _id: item.variant_id, product_id: product._id },
            { $inc: { stock: -item.quantity } }
          );
        } else {
          product.current_stock -= item.quantity;
          await product.save();
        }
      }

      // Coupon (if any)
      const couponItem = items.find(
        (item) => item.coupon_code && item.coupon_amount
      );
      let couponCode = null;
      let couponAmount = 0;
      if (couponItem) {
        couponCode = couponItem.coupon_code;
        couponAmount = couponItem.coupon_amount || 0;
        totalOrderPrice = Math.max(0, totalOrderPrice - couponAmount);
      }

      const order = new Order({
        customer_id: userId,
        order_items: orderItemIds,
        shipping_address: shippingAddressId,
        total_price: totalOrderPrice,
        status: "Pending",
        payment_status: "Unpaid",
        payment_method: req.body.payment_method || "COD",
        coupon_code: couponCode,
        coupon_amount: couponAmount,
        seller_id: sellerKey === "admin" ? null : items[0].seller_id?._id,
        seller_is: sellerKey === "admin" ? "admin" : "seller",
      });

      await order.save();
      orderResults.push(order._id);

      const transaction = new Transaction({
        order_id: order._id,
        user_id: userId,
        paid_by: userId,
        paid_to: sellerKey === "admin" ? null : items[0].seller_id?._id,
        payment_status: "Pending",
        amount: totalOrderPrice,
      });

      await transaction.save();

      await OrderItemDetail.updateMany(
        { _id: { $in: orderItemIds } },
        { order_id: order._id }
      );
    }

    // Clear cart
    await Cart.deleteMany({ customer_id: userId });

    return res.status(201).json({
      message: "Orders placed successfully",
      order_ids: orderResults,
    });
  } catch (error) {
    console.error("Error placing order:", error);
    return res.status(500).json({ message: "Server error" });
  }
}

const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const orders = await Order.find({ customer_id: userId })
      .populate({
        path: "order_items",
        populate: {
          path: "seller_id",
          select: "shop_name",
        },
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      status: true,
      message: "User orders fetched successfully",
      data: orders,
    });
  } catch (err) {
    console.error("Error fetching user orders:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

/**
 * Get a specific order by ID for the authenticated user
 */
const getUserOrderById = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      customer_id: req.user.id,
    })
      .populate("customer_id", "name email mobile")
      .populate("shipping_address")
      .populate({
        path: "order_items",
        populate: [
          {
            path: "product_id",
            select: "name thumbnail",
          },
          {
            path: "seller_id",
            select: "shop_name",
          },
        ],
      });

    if (!order) {
      return res.status(404).json({
        status: false,
        message: "Order not found or unauthorized",
      });
    }

    return res.status(200).json({
      status: true,
      message: "Order fetched successfully",
      data: order,
    });
  } catch (err) {
    console.error("Error fetching order by ID:", err);
    return res.status(500).json({ status: false, message: "Server error" });
  }
};

async function placeOrderOnline(req, res) {
  try {
    const userId = req.user.id;
    const shippingAddressId = req.body.address_id;

    const cartItems = await Cart.find({ customer_id: userId })
      .populate("product_id")
      .populate("seller_id");

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // Validate stock
    for (const item of cartItems) {
      const product = item.product_id;
      if (!product) {
        return res
          .status(400)
          .json({ message: `Product not found for cart item ${item._id}` });
      }

      if (item.is_variant && item.variant_id) {
        const variant = await VariantOption.findOne({
          _id: item.variant_id,
          product_id: product._id,
        });
        if (!variant || variant.stock < item.quantity) {
          return res.status(400).json({
            message: `Insufficient stock for variant of product ${product.name}`,
          });
        }
      } else if (product.current_stock < item.quantity) {
        return res
          .status(400)
          .json({ message: `Insufficient stock for product ${product.name}` });
      }
    }

    // Group by seller
    const groupedItems = {};
    for (const item of cartItems) {
      const sellerKey =
        item.added_by === "admin" ? "admin" : item.seller_id?._id?.toString();
      if (!groupedItems[sellerKey]) groupedItems[sellerKey] = [];
      groupedItems[sellerKey].push(item);
    }

    const orderResults = [];

    for (const [sellerKey, items] of Object.entries(groupedItems)) {
      let totalOrderPrice = 0;
      const orderItemIds = [];

      for (const item of items) {
        const product = item.product_id;
        const itemTotalPrice = item.total_price + (item.shipping_cost || 0);
        totalOrderPrice += itemTotalPrice;

        const productSnapshot = product.toObject();
        delete productSnapshot.__v;
        delete productSnapshot.createdAt;
        delete productSnapshot.updatedAt;

        const sellerId =
          sellerKey === "admin" ? null : items[0]?.seller_id?._id || null;

        const orderItem = new OrderItemDetail({
          product_id: product._id,
          product_detail: productSnapshot,
          name: product.name,
          thumbnail: product.thumbnail,
          selected_variant: item.selected_variant,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: itemTotalPrice,
          tax: item.tax,
          discount: item.discount,
          discount_type: item.discount_type,
          tax_model: item.tax_model,
          slug: item.slug,
          seller_id: sellerId,
          seller_is: sellerKey === "admin" ? "admin" : "seller",
          shipping_cost: item.shipping_cost,
          shipping_type: item.shipping_type,
          shipping_address: shippingAddressId,
          delivery_status: "Pending",
        });

        await orderItem.save();
        orderItemIds.push(orderItem._id);

        // Deduct stock
        if (item.is_variant && item.variant_id) {
          await VariantOption.findOneAndUpdate(
            { _id: item.variant_id, product_id: product._id },
            { $inc: { stock: -item.quantity } }
          );
        } else {
          product.current_stock -= item.quantity;
          await product.save();
        }
      }

      // Coupon
      const couponItem = items.find(
        (item) => item.coupon_code && item.coupon_amount
      );
      let couponCode = null;
      let couponAmount = 0;
      if (couponItem) {
        couponCode = couponItem.coupon_code;
        couponAmount = couponItem.coupon_amount || 0;
        totalOrderPrice = Math.max(0, totalOrderPrice - couponAmount);
      }

      const order = new Order({
        customer_id: userId,
        order_items: orderItemIds,
        shipping_address: shippingAddressId,
        total_price: totalOrderPrice,
        status: "Confirmed",
        payment_status: "Paid",
        payment_method: req.body.payment_method || "offline", // e.g., cash, QR
        coupon_code: couponCode,
        coupon_amount: couponAmount,
        seller_id: sellerKey === "admin" ? null : items[0].seller_id?._id,
        seller_is: sellerKey === "admin" ? "admin" : "seller",
      });

      await order.save();
      orderResults.push(order._id);

      const transaction = new Transaction({
        order_id: order._id,
        user_id: userId,
        paid_by: userId,
        paid_to: sellerKey === "admin" ? null : items[0].seller_id?._id,
        amount: totalOrderPrice,
        payment_status: "Paid",
      });

      await transaction.save();

      await OrderItemDetail.updateMany(
        { _id: { $in: orderItemIds } },
        { order_id: order._id }
      );
    }

    await Cart.deleteMany({ customer_id: userId });

    return res.status(201).json({
      message: "Online order placed successfully",
      order_ids: orderResults,
    });
  } catch (error) {
    console.error("Error placing Online order:", error);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  placeOrder,
  getUserOrders,
  getUserOrderById,
  placeOrderOnline,
};
