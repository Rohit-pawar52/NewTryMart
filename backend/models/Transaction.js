const mongoose = require("mongoose");
const { Schema } = mongoose;

const transactionSchema = new Schema(
  {
    order_id: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    paid_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    paid_to: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    payment_status: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
    },
    amount: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Transaction", transactionSchema);
